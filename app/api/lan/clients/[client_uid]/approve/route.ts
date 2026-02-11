export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";
import { resolveSeatUsage } from "@/app/lib/seat-limits";

export async function POST(req: NextRequest, { params }: { params: { client_uid: string } }) {
  const access = await requireAnyPermission(req, ["perm.users.approve", "perm.users.manage"], "Forbidden");
  if ("response" in access) return access.response;

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const actorUserId = access.ctx.userId > 0 ? access.ctx.userId : getRequestUserId(req, 1);
  const clientUid = String(params.client_uid || "").trim();
  if (!clientUid) {
    return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingRs = await client.query(
      `SELECT client_uid, status
         FROM lan_clients
        WHERE business_id = $1
          AND client_uid = $2
        FOR UPDATE`,
      [businessId, clientUid]
    );

    if (existingRs.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const currentStatus = String(existingRs.rows?.[0]?.status || "").toLowerCase();
    if (currentStatus !== "active") {
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

      await client.query(
        `UPDATE lan_clients
            SET status = 'active',
                updated_at = NOW()
          WHERE business_id = $1
            AND client_uid = $2`,
        [businessId, clientUid]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, $2, 'lan.client.approve', 'lan_clients', $3, $4::jsonb)`,
      [businessId, actorUserId, clientUid, JSON.stringify({ previous_status: currentStatus })]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      client_uid: clientUid,
      status: "active",
      already_active: currentStatus === "active",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/lan/clients/[client_uid]/approve failed:", err);
    return NextResponse.json({ error: "Failed to approve client" }, { status: 500 });
  } finally {
    client.release();
  }
}
