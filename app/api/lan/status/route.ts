export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAnyPermission } from "@/app/lib/request-access";
import { resolveSeatUsage } from "@/app/lib/seat-limits";

export async function GET(req: NextRequest) {
  const access = await requireAnyPermission(
    req,
    ["perm.settings.manage", "perm.users.manage", "perm.users.approve"],
    "Forbidden"
  );
  if ("response" in access) return access.response;

  try {
    const businessId = access.ctx.businessId;

    const [hostRs, clientsRs, pairingRs, rolesRs, syncRs, seatUsage] = await Promise.all([
      pool.query(
        `SELECT business_id, host_uid, host_name, mode, allow_pairing, require_approval, bind_address, port, updated_at
           FROM lan_host_configs
          WHERE business_id = $1
          LIMIT 1`,
        [businessId]
      ),
      pool.query(
        `SELECT client_uid, device_name, role_code, status, paired_at, last_seen_at
           FROM lan_clients
          WHERE business_id = $1
          ORDER BY paired_at DESC
          LIMIT 200`,
        [businessId]
      ),
      pool.query(
        `SELECT pairing_uid, status, expires_at, max_uses, used_uses, created_at
           FROM lan_pairing_sessions
          WHERE business_id = $1
            AND status = 'active'
            AND expires_at > NOW()
          ORDER BY created_at DESC
          LIMIT 20`,
        [businessId]
      ),
      pool.query(
        `SELECT lower(code) AS code
           FROM roles
          WHERE business_id = $1 OR business_id IS NULL
          ORDER BY business_id NULLS LAST, code ASC`,
        [businessId]
      ),
      pool.query(
        `SELECT
            COALESCE(MAX(id), 0) AS latest_event_id,
            COUNT(*) FILTER (WHERE created_at >= NOW() - interval '1 day')::int AS events_24h
           FROM lan_sync_events
          WHERE business_id = $1`,
        [businessId]
      ),
      resolveSeatUsage(pool, businessId).catch(() => null),
    ]);

    return NextResponse.json({
      business_id: businessId,
      host: hostRs.rows?.[0] || null,
      clients: clientsRs.rows || [],
      active_pairing_sessions: pairingRs.rows || [],
      available_roles: Array.from(new Set((rolesRs.rows || []).map((r: any) => String(r.code)))),
      sync: syncRs.rows?.[0] || { latest_event_id: 0, events_24h: 0 },
      seat_usage: seatUsage,
    });
  } catch (err) {
    console.error("GET /api/lan/status failed:", err);
    return NextResponse.json({ error: "Failed to load LAN status" }, { status: 500 });
  }
}
