export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAnyPermission } from "@/app/lib/request-access";

export async function GET(req: NextRequest) {
  const access = await requireAnyPermission(req, ["perm.users.approve", "perm.users.manage"], "Forbidden");
  if ("response" in access) return access.response;

  const businessId = access.ctx.businessId;

  try {
    const rs = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
              a.id AS approval_id, a.meta
         FROM users u
         LEFT JOIN approvals a
           ON a.user_id = u.id
          AND a.status = 'pending'
          AND a.request_type IN ('signup', 'admin_user_create')
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
