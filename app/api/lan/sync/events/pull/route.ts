export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { authenticateLanClient } from "@/app/lib/lan-auth";

function parsePositiveInt(input: string | null, fallback: number) {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export async function GET(req: Request) {
  const auth = await authenticateLanClient(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized", reason: "reason" in auth ? auth.reason : "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const sinceId = parsePositiveInt(url.searchParams.get("since_id"), 0);
  const limit = Math.min(500, Math.max(1, parsePositiveInt(url.searchParams.get("limit"), 200)));

  const rs = await pool.query(
    `SELECT id, client_uid, event_type, entity_type, entity_id, source_event_uid, payload_json, created_at
       FROM lan_sync_events
      WHERE business_id = $1
        AND id > $2
        AND (client_uid IS NULL OR client_uid <> $3)
      ORDER BY id ASC
      LIMIT $4`,
    [auth.businessId, sinceId, auth.clientUid, limit]
  );

  const rows = rs.rows || [];
  const nextSinceId = rows.length > 0 ? Number(rows[rows.length - 1].id || sinceId) : sinceId;

  await pool.query(
    `UPDATE lan_clients
        SET last_seen_at = NOW(),
            updated_at = NOW(),
            meta_json = jsonb_set(
              COALESCE(meta_json, '{}'::jsonb),
              '{last_pull_event_id}',
              to_jsonb($3::bigint),
              true
            )
      WHERE business_id = $1
        AND client_uid = $2`,
    [auth.businessId, auth.clientUid, nextSinceId]
  );

  return NextResponse.json({
    ok: true,
    since_id: sinceId,
    next_since_id: nextSinceId,
    items: rows,
  });
}
