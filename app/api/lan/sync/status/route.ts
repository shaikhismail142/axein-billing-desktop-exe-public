export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAnyPermission } from "@/app/lib/request-access";

export async function GET(req: NextRequest) {
  const access = await requireAnyPermission(
    req,
    ["perm.settings.manage", "perm.users.manage", "perm.users.approve"],
    "Forbidden"
  );
  if ("response" in access) return access.response;

  const businessId = access.ctx.businessId;

  const [eventsRs, jobsRs, clientsRs] = await Promise.all([
    pool.query(
      `SELECT
          COALESCE(MAX(id), 0) AS latest_event_id,
          COUNT(*) FILTER (WHERE created_at >= NOW() - interval '1 hour')::int AS events_1h,
          COUNT(*) FILTER (WHERE created_at >= NOW() - interval '1 day')::int AS events_24h
         FROM lan_sync_events
        WHERE business_id = $1`,
      [businessId]
    ),
    pool.query(
      `SELECT status, COUNT(*)::int AS count
         FROM lan_sync_jobs
        WHERE business_id = $1
        GROUP BY status`,
      [businessId]
    ),
    pool.query(
      `SELECT
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_clients,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_clients,
          COUNT(*) FILTER (WHERE status = 'revoked')::int AS revoked_clients
         FROM lan_clients
        WHERE business_id = $1`,
      [businessId]
    ),
  ]);

  return NextResponse.json({
    ok: true,
    business_id: businessId,
    events: eventsRs.rows?.[0] || { latest_event_id: 0, events_1h: 0, events_24h: 0 },
    jobs: jobsRs.rows || [],
    clients: clientsRs.rows?.[0] || { active_clients: 0, pending_clients: 0, revoked_clients: 0 },
  });
}
