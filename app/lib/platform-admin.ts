import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { readSessionFromRequest } from "@/app/lib/session";

export async function requirePlatformAdmin(req: Request) {
  const session = readSessionFromRequest(req);
  if (!session) return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const rs = await pool.query(
    `SELECT id FROM users WHERE id=$1 AND business_id=$2 AND status='active' AND is_system_admin=TRUE LIMIT 1`,
    [session.user_id, session.business_id]
  );
  if (!rs.rowCount) return { ok: false as const, response: NextResponse.json({ error: "platform_admin_required" }, { status: 403 }) };
  return { ok: true as const, session };
}
