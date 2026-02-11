export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { hashWithSecret, randomId, randomToken, safeEqHex } from "@/app/lib/lan-crypto";
import { resolveSeatUsage } from "@/app/lib/seat-limits";

type Body = {
  business_code?: string;
  pairing_code?: string;
  device_name?: string;
  device_fingerprint?: string;
  requested_role?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;

  const businessCode = String(body.business_code || "").trim().toLowerCase();
  const pairingCode = String(body.pairing_code || "").trim().toUpperCase();
  const deviceName = String(body.device_name || "").trim() || "AxEin LAN Client";
  const deviceFingerprint = String(body.device_fingerprint || "").trim() || null;
  const requestedRole = String(body.requested_role || "billing_staff").trim().toLowerCase();

  if (!businessCode || !pairingCode) {
    return NextResponse.json({ error: "business_code and pairing_code are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const businessRs = await client.query(
      `SELECT id, code FROM businesses WHERE lower(code) = $1 AND is_active = TRUE LIMIT 1`,
      [businessCode]
    );
    if (businessRs.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    const businessId = Number(businessRs.rows[0].id);

    const hostRs = await client.query(
      `SELECT host_secret, require_approval
         FROM lan_host_configs
        WHERE business_id = $1
        LIMIT 1`,
      [businessId]
    );
    if (hostRs.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "LAN host not configured" }, { status: 400 });
    }

    const pairingRs = await client.query(
      `SELECT id, pairing_uid, code_hash, status, expires_at, max_uses, used_uses
         FROM lan_pairing_sessions
        WHERE business_id = $1
          AND status = 'active'
          AND expires_at > NOW()
          AND used_uses < max_uses
        ORDER BY created_at DESC`,
      [businessId]
    );

    const hostSecret = String(hostRs.rows[0].host_secret || "");
    const requireApproval = hostRs.rows[0].require_approval === true;
    const targetHash = hashWithSecret(pairingCode, hostSecret);

    let match: any = null;
    for (const row of pairingRs.rows || []) {
      if (safeEqHex(String(row.code_hash || ""), targetHash)) {
        match = row;
        break;
      }
    }

    if (!match) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invalid or expired pairing code" }, { status: 401 });
    }

    const seatUsage = await resolveSeatUsage(client, businessId);
    if (seatUsage.used_seats >= seatUsage.seat_limit) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `Seat limit reached (${seatUsage.seat_limit}). Upgrade license to add more users/devices.`,
          seat_usage: seatUsage,
        },
        { status: 403 }
      );
    }
    if (seatUsage.active_computers >= seatUsage.computer_limit) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `Computer limit reached (${seatUsage.computer_limit}). Increase licensed computers to add more PCs.`,
          seat_usage: seatUsage,
        },
        { status: 403 }
      );
    }

    const clientUid = randomId("client");
    const clientToken = randomToken(24);
    const tokenHash = hashWithSecret(clientToken, hostSecret);
    const roleRs = await client.query(
      `SELECT code
         FROM roles
        WHERE (business_id = $1 OR business_id IS NULL)
          AND lower(code) = lower($2)
        ORDER BY business_id NULLS LAST
        LIMIT 1`,
      [businessId, requestedRole]
    );
    const effectiveRole = roleRs.rowCount > 0 ? String(roleRs.rows[0].code) : "billing_staff";

    await client.query(
      `INSERT INTO lan_clients
        (business_id, client_uid, device_name, device_fingerprint, role_code, status, token_hash, paired_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        businessId,
        clientUid,
        deviceName,
        deviceFingerprint,
        effectiveRole,
        requireApproval ? "pending" : "active",
        tokenHash,
      ]
    );

    await client.query(
      `UPDATE lan_pairing_sessions
          SET used_uses = used_uses + 1,
              status = CASE WHEN used_uses + 1 >= max_uses THEN 'consumed' ELSE status END,
              updated_at = NOW()
        WHERE id = $1`,
      [match.id]
    );

    await client.query(
      `INSERT INTO audit_logs (business_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, 'lan.client.paired', 'lan_clients', $2, $3::jsonb)`,
      [
        businessId,
        clientUid,
        JSON.stringify({
          device_name: deviceName,
          role_code: effectiveRole,
          require_approval: requireApproval,
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      business_id: businessId,
      business_code: businessRs.rows[0].code,
      client_uid: clientUid,
      client_token: clientToken,
      role_code: effectiveRole,
      status: requireApproval ? "pending" : "active",
      approval_required: requireApproval,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/lan/pair/complete failed:", err);
    return NextResponse.json({ error: "Failed to complete pairing" }, { status: 500 });
  } finally {
    client.release();
  }
}
