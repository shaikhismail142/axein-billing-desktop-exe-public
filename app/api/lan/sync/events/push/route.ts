export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { authenticateLanClient } from "@/app/lib/lan-auth";

type SyncEventInput = {
  event_uid?: string;
  event_type?: string;
  entity_type?: string;
  entity_id?: string;
  payload?: Record<string, unknown>;
};

type Body = {
  events?: SyncEventInput[];
};

function normalizeText(input: unknown, max = 120) {
  return String(input || "").trim().slice(0, max);
}

export async function POST(req: Request) {
  const auth = await authenticateLanClient(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized", reason: "reason" in auth ? auth.reason : "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const rawEvents = Array.isArray(body.events) ? body.events : [];
  if (rawEvents.length === 0) {
    return NextResponse.json({ error: "events must be a non-empty array" }, { status: 400 });
  }

  const events = rawEvents.slice(0, 200).map((evt) => ({
    event_uid: normalizeText(evt?.event_uid || "", 80) || null,
    event_type: normalizeText(evt?.event_type || "", 80),
    entity_type: normalizeText(evt?.entity_type || "", 80) || null,
    entity_id: normalizeText(evt?.entity_id || "", 120) || null,
    payload: evt?.payload && typeof evt.payload === "object" ? evt.payload : {},
  }));

  if (events.some((evt) => !evt.event_type)) {
    return NextResponse.json({ error: "Each event requires event_type" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let inserted = 0;
    let duplicates = 0;
    let lastEventId = 0;

    for (const evt of events) {
      const rs = await client.query(
        `INSERT INTO lan_sync_events
          (business_id, client_uid, event_type, entity_type, entity_id, source_event_uid, payload_json)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (business_id, client_uid, source_event_uid)
         WHERE source_event_uid IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [
          auth.businessId,
          auth.clientUid,
          evt.event_type,
          evt.entity_type,
          evt.entity_id,
          evt.event_uid,
          JSON.stringify(evt.payload || {}),
        ]
      );

      if (rs.rowCount > 0) {
        inserted += 1;
        lastEventId = Math.max(lastEventId, Number(rs.rows[0].id || 0));
      } else {
        duplicates += 1;
      }
    }

    await client.query(
      `UPDATE lan_clients
          SET last_seen_at = NOW(),
              updated_at = NOW(),
              meta_json = jsonb_set(
                COALESCE(meta_json, '{}'::jsonb),
                '{last_pushed_event_at}',
                to_jsonb(NOW()::text),
                true
              )
        WHERE business_id = $1
          AND client_uid = $2`,
      [auth.businessId, auth.clientUid]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      inserted,
      duplicates,
      received: rawEvents.length,
      last_event_id: lastEventId || null,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/lan/sync/events/push failed:", err);
    return NextResponse.json({ error: "Failed to push sync events" }, { status: 500 });
  } finally {
    client.release();
  }
}
