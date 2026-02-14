export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAnyPermission, requireAllPermissions } from "@/app/lib/request-access";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(5000, Math.max(10, Number(url.searchParams.get("limit") || 500)));
    const format = String(url.searchParams.get("format") || "json").toLowerCase();
    const action = String(url.searchParams.get("action") || "").trim();
    const entityType = String(url.searchParams.get("entity_type") || "").trim();
    const q = String(url.searchParams.get("q") || "").trim();

    const access =
      format === "ndjson"
        ? await requireAllPermissions(req, ["perm.logs.view", "perm.logs.export"], "Forbidden")
        : await requireAnyPermission(req, ["perm.logs.view"], "Forbidden");
    if ("response" in access) return access.response;
    const businessId = access.ctx.businessId;

    const where: string[] = ["a.business_id = $1"];
    const params: any[] = [businessId];

    if (action) {
      params.push(`%${action}%`);
      where.push(`a.action ILIKE $${params.length}`);
    }
    if (entityType) {
      params.push(entityType);
      where.push(`a.entity_type = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(a.action ILIKE $${params.length} OR a.entity_type ILIKE $${params.length} OR a.entity_id ILIKE $${params.length})`);
    }

    params.push(limit);
    const rs = await pool.query(
      `SELECT
          a.id,
          a.created_at,
          a.action,
          a.entity_type,
          a.entity_id,
          a.actor_user_id,
          u.full_name AS actor_name,
          u.email AS actor_email,
          a.meta_json
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY a.id DESC
        LIMIT $${params.length}`,
      params
    );

    if (format === "ndjson") {
      const lines = rs.rows.map((r: any) => JSON.stringify(r)).join("\n");
      return new NextResponse(lines + (lines ? "\n" : ""), {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Content-Disposition": `attachment; filename=axein-audit-logs-${Date.now()}.ndjson`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({ items: rs.rows || [] });
  } catch (err) {
    console.error("GET /api/audit-logs failed:", err);
    return NextResponse.json({ error: "Failed to load audit logs" }, { status: 500 });
  }
}

