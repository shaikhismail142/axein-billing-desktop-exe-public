export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { readSessionFromRequest, makeClearedSessionCookie } from "@/app/lib/session";
import { getUserPermissionCodes } from "@/app/lib/platform-rbac";
import { getTenantEntitlement } from "@/app/lib/tenant-entitlements";

export async function GET(req: Request) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { ok: true, authenticated: false, user: null },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const userRs = await pool.query(
      `SELECT
         u.id,
         u.business_id,
         u.full_name,
         u.email,
         lower(u.status) AS status,
         b.code AS business_code,
         b.name AS business_name
       FROM users u
       JOIN businesses b ON b.id = u.business_id
      WHERE u.id = $1
        AND u.business_id = $2
        AND b.is_active = TRUE
      LIMIT 1`,
      [session.user_id, session.business_id]
    );

    if (!userRs.rowCount || String(userRs.rows[0].status || "") !== "active") {
      return NextResponse.json(
        { ok: true, authenticated: false, user: null },
        {
          headers: {
            "Set-Cookie": makeClearedSessionCookie(),
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const row = userRs.rows[0] as any;
    const permissionCodes = await getUserPermissionCodes(Number(row.id), Number(row.business_id)).catch(() => []);
    const entitlement = await getTenantEntitlement(Number(row.business_id));

    return NextResponse.json(
      {
        ok: true,
        authenticated: true,
        user: {
          id: Number(row.id),
          business_id: Number(row.business_id),
          full_name: String(row.full_name || ""),
          email: String(row.email || ""),
          business_code: String(row.business_code || ""),
          business_name: String(row.business_name || ""),
          role_codes: Array.isArray(session.role_codes) ? session.role_codes : [],
          permission_codes: permissionCodes,
          entitlement,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/auth/session failed:", err);
    return NextResponse.json({ ok: false, authenticated: false, user: null }, { status: 500 });
  }
}
