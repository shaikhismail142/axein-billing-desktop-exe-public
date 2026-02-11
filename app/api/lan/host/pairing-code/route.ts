export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";
import { hashWithSecret, randomId, randomPairingCode } from "@/app/lib/lan-crypto";

type Body = {
  ttl_minutes?: number;
  max_uses?: number;
};

export async function POST(req: NextRequest) {
  const access = await requireAnyPermission(req, ["perm.settings.manage"], "Forbidden");
  if ("response" in access) return access.response;

  const body = (await req.json().catch(() => ({}))) as Body;
  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const actorUserId = access.ctx.userId > 0 ? access.ctx.userId : getRequestUserId(req, 1);

  const ttl = Math.max(2, Math.min(60, Number(body.ttl_minutes || 10)));
  const maxUses = Math.max(1, Math.min(20, Number(body.max_uses || 1)));

  const hostRs = await pool.query(
    `SELECT host_secret, allow_pairing
       FROM lan_host_configs
      WHERE business_id = $1
      LIMIT 1`,
    [businessId]
  );

  if (hostRs.rowCount === 0) {
    return NextResponse.json({ error: "LAN host is not configured" }, { status: 400 });
  }

  if (hostRs.rows[0].allow_pairing !== true) {
    return NextResponse.json({ error: "Pairing is disabled for this host" }, { status: 403 });
  }

  const pairingCode = randomPairingCode();
  const pairingUid = randomId("pair");
  const codeHash = hashWithSecret(pairingCode, String(hostRs.rows[0].host_secret || ""));

  const rs = await pool.query(
    `INSERT INTO lan_pairing_sessions
      (business_id, pairing_uid, code_hash, status, expires_at, max_uses, used_uses, created_by)
     VALUES
      ($1, $2, $3, 'active', NOW() + ($4::text || ' minutes')::interval, $5, 0, $6)
     RETURNING pairing_uid, expires_at, max_uses, used_uses, status`,
    [businessId, pairingUid, codeHash, String(ttl), maxUses, actorUserId]
  );

  await pool.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
     VALUES ($1, $2, 'lan.pairing.create', 'lan_pairing_sessions', $3, $4::jsonb)`,
    [businessId, actorUserId, pairingUid, JSON.stringify({ ttl_minutes: ttl, max_uses: maxUses })]
  );

  return NextResponse.json({
    ok: true,
    pairing_uid: rs.rows[0].pairing_uid,
    pairing_code: pairingCode,
    expires_at: rs.rows[0].expires_at,
    max_uses: rs.rows[0].max_uses,
    used_uses: rs.rows[0].used_uses,
    status: rs.rows[0].status,
  });
}
