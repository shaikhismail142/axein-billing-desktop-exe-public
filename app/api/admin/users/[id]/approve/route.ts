export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isAdmin } from "@/app/lib/auth";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { getUserPermissionCodes } from "@/app/lib/platform-rbac";

type ApproveBody = {
  role_codes?: string[];
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = Number(params.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as ApproveBody;
  const requestedRoles = Array.isArray(body.role_codes)
    ? body.role_codes.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
    : [];

  const businessId = getRequestBusinessId(req, 1);
  const approverUserId = getRequestUserId(req, 1);
  const bypass = await isAdmin(req);
  if (!bypass) {
    const permissions = await getUserPermissionCodes(approverUserId, businessId).catch(() => []);
    if (!permissions.includes("perm.users.approve")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userRs = await client.query(
      `SELECT id, business_id, status
         FROM users
        WHERE id = $1
          AND business_id = $2
        FOR UPDATE`,
      [userId, businessId]
    );
    if (userRs.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const currentStatus = String(userRs.rows[0].status || "").toLowerCase();
    if (currentStatus === "active") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "User already approved" }, { status: 409 });
    }

    await client.query(
      `UPDATE users
          SET status = 'active', approved_by = $2, approved_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [userId, approverUserId]
    );

    const roleCodes = requestedRoles.length > 0 ? requestedRoles : ["billing_staff"];
    const roleRs = await client.query(
      `SELECT id, lower(code) AS code
         FROM roles
        WHERE (business_id = $1 OR business_id IS NULL)
          AND lower(code) = ANY($2::text[])`,
      [businessId, roleCodes]
    );

    for (const role of roleRs.rows) {
      await client.query(
        `INSERT INTO user_role_map (user_id, role_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, role.id]
      );
    }

    await client.query(
      `UPDATE approvals
          SET status = 'approved', decided_by = $2, decided_at = NOW(), updated_at = NOW()
        WHERE user_id = $1
          AND business_id = $3
          AND status = 'pending'`,
      [userId, approverUserId, businessId]
    );

    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, $2, 'user.approve', 'user', $3::text, $4::jsonb)`,
      [businessId, approverUserId, userId, JSON.stringify({ roles: roleCodes })]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      user_id: userId,
      roles_assigned: roleCodes,
      approved_by: approverUserId,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/admin/users/[id]/approve failed:", err);
    return NextResponse.json({ error: "Failed to approve user" }, { status: 500 });
  } finally {
    client.release();
  }
}
