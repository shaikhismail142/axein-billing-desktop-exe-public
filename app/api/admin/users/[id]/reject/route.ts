export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = Number(params.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const access = await requireAnyPermission(req, ["perm.users.approve", "perm.users.manage"], "Forbidden");
  if ("response" in access) return access.response;

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const actorUserId = access.ctx.userId > 0 ? access.ctx.userId : getRequestUserId(req, 1);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userRs = await client.query(
      `SELECT id, status
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

    const currentStatus = String(userRs.rows?.[0]?.status || "").toLowerCase();
    if (currentStatus === "active") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "User is already active. Revoke access from user management instead." },
        { status: 409 }
      );
    }
    if (currentStatus === "rejected") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "User is already rejected" }, { status: 409 });
    }

    await client.query(
      `UPDATE users
          SET status = 'rejected',
              approved_by = $2,
              approved_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [userId, actorUserId]
    );

    await client.query(
      `UPDATE approvals
          SET status = 'rejected',
              decided_by = $2,
              decided_at = NOW(),
              updated_at = NOW()
        WHERE user_id = $1
          AND business_id = $3
          AND status = 'pending'`,
      [userId, actorUserId, businessId]
    );

    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, $2, 'user.reject', 'user', $3::text, $4::jsonb)`,
      [businessId, actorUserId, userId, JSON.stringify({ previous_status: currentStatus })]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      user_id: userId,
      status: "rejected",
      rejected_by: actorUserId,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/admin/users/[id]/reject failed:", err);
    return NextResponse.json({ error: "Failed to reject user" }, { status: 500 });
  } finally {
    client.release();
  }
}
