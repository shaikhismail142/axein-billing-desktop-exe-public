export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { authenticateLanClient } from "@/app/lib/lan-auth";

type Body = {
  last_event_id?: number;
};

export async function POST(req: Request) {
  const auth = await authenticateLanClient(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized", reason: auth.reason }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const lastEventId = Number(body.last_event_id || 0);
  if (!Number.isFinite(lastEventId) || lastEventId < 0) {
    return NextResponse.json({ error: "last_event_id must be >= 0" }, { status: 400 });
  }

  await pool.query(
    `UPDATE lan_clients
        SET last_seen_at = NOW(),
            updated_at = NOW(),
            meta_json = jsonb_set(
              COALESCE(meta_json, '{}'::jsonb),
              '{last_synced_event_id}',
              to_jsonb($3::bigint),
              true
            )
      WHERE business_id = $1
        AND client_uid = $2`,
    [auth.businessId, auth.clientUid, Math.floor(lastEventId)]
  );

  return NextResponse.json({
    ok: true,
    client_uid: auth.clientUid,
    last_event_id: Math.floor(lastEventId),
  });
}
