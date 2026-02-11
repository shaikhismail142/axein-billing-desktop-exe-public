export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAllPermissions } from "@/app/lib/request-access";

function parseLimit(input: string | null, fallback: number, max: number) {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(10, Math.min(max, Math.floor(n)));
}

export async function GET(req: Request) {
  const access = await requireAllPermissions(req, ["perm.logs.view", "perm.logs.export"], "Forbidden");
  if (!access.ok) return access.response;

  const businessId = access.ctx.businessId;
  const url = new URL(req.url);
  const logsLimit = parseLimit(url.searchParams.get("logs_limit"), 1000, 5000);
  const auditLimit = parseLimit(url.searchParams.get("audit_limit"), 500, 3000);

  const [businessRs, appLogsRs, auditRs, lanRs, activationRs] = await Promise.all([
    pool.query(
      `SELECT id, code, name, business_type, usage_mode, user_limit, updated_at
         FROM businesses
        WHERE id = $1
        LIMIT 1`,
      [businessId]
    ),
    pool.query(
      `SELECT id, created_at, level, source, event_code, message, context_json
         FROM app_logs
        WHERE business_id = $1
        ORDER BY id DESC
        LIMIT $2`,
      [businessId, logsLimit]
    ),
    pool.query(
      `SELECT id, created_at, action, entity_type, entity_id, actor_user_id, meta_json
         FROM audit_logs
        WHERE business_id = $1
        ORDER BY id DESC
        LIMIT $2`,
      [businessId, auditLimit]
    ),
    pool.query(
      `SELECT
          (SELECT COUNT(*)::int FROM lan_clients WHERE business_id = $1 AND status = 'active') AS active_lan_clients,
          (SELECT COUNT(*)::int FROM lan_clients WHERE business_id = $1 AND status = 'pending') AS pending_lan_clients,
          (SELECT COUNT(*)::int FROM lan_sync_events WHERE business_id = $1 AND created_at >= NOW() - interval '1 day') AS lan_events_24h`,
      [businessId]
    ),
    pool.query(
      `SELECT value_json
         FROM settings
        WHERE key = 'activation'
        LIMIT 1`
    ),
  ]);

  const payload = {
    generated_at: new Date().toISOString(),
    business: businessRs.rows?.[0] || null,
    summary: {
      app_logs_count: appLogsRs.rowCount || 0,
      audit_logs_count: auditRs.rowCount || 0,
      lan: lanRs.rows?.[0] || { active_lan_clients: 0, pending_lan_clients: 0, lan_events_24h: 0 },
    },
    activation: activationRs.rows?.[0]?.value_json || null,
    app_logs: appLogsRs.rows || [],
    audit_logs: auditRs.rows || [],
  };

  const fileName = `axein-support-bundle-${businessId}-${Date.now()}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
