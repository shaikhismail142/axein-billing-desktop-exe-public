export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { requireAllPermissions, requireAnyPermission, resolveAccessContext } from "@/app/lib/request-access";

type LogBody = {
  level?: string;
  source?: string;
  event_code?: string;
  message?: string;
  context?: Record<string, unknown>;
  user_id?: number;
};

function normalizeLevel(input: string | undefined) {
  const s = String(input || "info").trim().toLowerCase();
  if (["trace", "debug", "info", "warn", "error", "fatal"].includes(s)) return s;
  return "info";
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as LogBody;
  const message = String(body.message || "").trim();

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  try {
    const ctx = await resolveAccessContext(req).catch(() => null);
    const businessId = ctx?.businessId || getRequestBusinessId(req, 1);
    const userId = Number(
      body.user_id || (ctx && ctx.userId > 0 ? ctx.userId : getRequestUserId(req, 1))
    );

    await pool.query(
      `INSERT INTO app_logs (business_id, user_id, level, source, event_code, message, context_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        businessId,
        Number.isFinite(userId) ? userId : null,
        normalizeLevel(body.level),
        body.source ? String(body.source).slice(0, 120) : null,
        body.event_code ? String(body.event_code).slice(0, 120) : null,
        message,
        JSON.stringify(body.context || {}),
      ]
    );

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("POST /api/logs failed:", err);
    return NextResponse.json({ error: "Failed to store log" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(5000, Math.max(10, Number(url.searchParams.get("limit") || 500)));
    const level = url.searchParams.get("level");
    const format = (url.searchParams.get("format") || "json").toLowerCase();
    const access =
      format === "ndjson"
        ? await requireAllPermissions(req, ["perm.logs.view", "perm.logs.export"], "Forbidden")
        : await requireAnyPermission(req, ["perm.logs.view"], "Forbidden");
    if ("response" in access) return access.response;
    const businessId = access.ctx.businessId;

    const where: string[] = ["business_id = $1"];
    const params: any[] = [businessId];

    if (level) {
      params.push(level.toLowerCase());
      where.push(`level = $${params.length}`);
    }

    params.push(limit);

    const rs = await pool.query(
      `SELECT id, business_id, user_id, level, source, event_code, message, context_json, created_at
         FROM app_logs
        WHERE ${where.join(" AND ")}
        ORDER BY id DESC
        LIMIT $${params.length}`,
      params
    );

    if (format === "ndjson") {
      const lines = rs.rows.map((r: any) => JSON.stringify(r)).join("\n");
      return new NextResponse(lines + (lines ? "\n" : ""), {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Content-Disposition": `attachment; filename=axein-logs-${Date.now()}.ndjson`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({ items: rs.rows });
  } catch (err) {
    console.error("GET /api/logs failed:", err);
    return NextResponse.json({ error: "Failed to load logs" }, { status: 500 });
  }
}
