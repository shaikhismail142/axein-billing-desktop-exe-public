export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isAdmin } from "@/app/lib/auth";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { getUserPermissionCodes } from "@/app/lib/platform-rbac";

export async function GET(req: NextRequest) {
  const businessId = getRequestBusinessId(req, 1);
  const requesterUserId = getRequestUserId(req, 1);
  const bypass = await isAdmin(req);
  if (!bypass) {
    const permissions = await getUserPermissionCodes(requesterUserId, businessId).catch(() => []);
    if (!permissions.includes("perm.users.approve")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const rs = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
              a.id AS approval_id, a.meta
         FROM users u
         LEFT JOIN approvals a
           ON a.user_id = u.id
          AND a.status = 'pending'
          AND a.request_type = 'signup'
        WHERE u.business_id = $1
          AND u.status = 'pending'
        ORDER BY u.created_at ASC`,
      [businessId]
    );

    return NextResponse.json({ items: rs.rows });
  } catch (err) {
    console.error("GET /api/admin/users/pending failed:", err);
    return NextResponse.json({ error: "Failed to load pending users" }, { status: 500 });
  }
}
