export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { makeClearedSessionCookie, readSessionFromRequest } from "@/app/lib/session";
import { pool } from "@/lib/db";

const DEFENZO_DASHBOARD = "https://defenzo.in/admin/dashboard.php";

export async function POST(req: Request) {
  const session = readSessionFromRequest(req);
  let redirect = "/login";
  if (session?.auth_provider === "defenzo") {
    redirect = DEFENZO_DASHBOARD;
  } else if (session?.business_id) {
    const tenant = await pool.query(
      `SELECT 1 FROM businesses WHERE id = $1 AND lower(code) = 'defenzo' LIMIT 1`,
      [session.business_id]
    );
    if (tenant.rowCount) redirect = DEFENZO_DASHBOARD;
  }
  return NextResponse.json(
    { ok: true, redirect },
    {
      headers: {
        "Set-Cookie": makeClearedSessionCookie(),
        "Cache-Control": "no-store",
      },
    }
  );
}
