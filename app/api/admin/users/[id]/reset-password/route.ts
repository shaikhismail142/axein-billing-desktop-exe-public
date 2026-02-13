export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

type ResetBody = {
  password?: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = Number(params.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const access = await requireAnyPermission(req, ["perm.users.manage"], "Forbidden");
  if ("response" in access) return access.response;

  const body = (await req.json().catch(() => ({}))) as ResetBody;
  const password = String(body.password || "");
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const actorUserId = access.ctx.userId > 0 ? access.ctx.userId : getRequestUserId(req, 1);
  const passwordHash = await bcrypt.hash(password, 10);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userRs = await client.query(
      `UPDATE users
          SET password_hash = $3,
              updated_at = NOW()
        WHERE id = $1
          AND business_id = $2
      RETURNING id, email, full_name`,
      [userId, businessId, passwordHash]
    );
    if (!userRs.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, $2, 'user.password.reset', 'user', $3::text, $4::jsonb)`,
      [businessId, actorUserId, userId, JSON.stringify({ by_admin: true })]
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, user: userRs.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/admin/users/[id]/reset-password failed:", err);
    return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
  } finally {
    client.release();
  }
}

