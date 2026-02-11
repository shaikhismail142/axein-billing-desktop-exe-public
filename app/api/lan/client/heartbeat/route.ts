export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { authenticateLanClient } from "@/app/lib/lan-auth";

export async function POST(req: Request) {
  const auth = await authenticateLanClient(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized", reason: auth.reason }, { status: 401 });
  }

  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null;

  await pool.query(
    `UPDATE lan_clients
        SET last_seen_at = NOW(),
            last_ip = $2,
            updated_at = NOW()
      WHERE business_id = $1
        AND client_uid = $3`,
    [auth.businessId, ip, auth.clientUid]
  );

  return NextResponse.json({ ok: true, client_uid: auth.clientUid, server_time: new Date().toISOString() });
}
