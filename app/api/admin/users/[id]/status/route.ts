export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";
import { resolveSeatUsage } from "@/app/lib/seat-limits";

type Body = {
  status?: string;
};

function normalizeStatus(input: unknown) {
  const s = String(input || "").trim().toLowerCase();
  if (s === "active") return "active";
  if (s === "disabled") return "disabled";
  return "";
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = Number(params.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const access = await requireAnyPermission(req, ["perm.users.manage"], "Forbidden");
  if ("response" in access) return access.response;

  const body = (await req.json().catch(() => ({}))) as Body;
  const desired = normalizeStatus(body.status);
  if (!desired) {
    return NextResponse.json({ error: "Invalid status. Use 'active' or 'disabled'." }, { status: 400 });
  }

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const actorUserId = access.ctx.userId > 0 ? access.ctx.userId : getRequestUserId(req, 1);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userRs = await client.query(
      `SELECT id, lower(status) AS status
         FROM users
        WHERE id = $1
          AND business_id = $2
        FOR UPDATE`,
      [userId, businessId]
    );
    if (!userRs.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const current = String(userRs.rows?.[0]?.status || "").toLowerCase();
    if (desired === current) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: true, user_id: userId, status: desired });
    }

    if (desired === "disabled" && current !== "active") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: `Cannot disable user in status '${current}'` }, { status: 409 });
    }

    if (desired === "active" && current !== "disabled") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Cannot enable user in status '${current}'. Use approval flow for pending users.` },
        { status: 409 }
      );
    }

    if (desired === "active") {
      const seatUsage = await resolveSeatUsage(client, businessId);
      if (seatUsage.used_seats >= seatUsage.seat_limit) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error: `Seat limit reached (${seatUsage.seat_limit}). Disable another user or upgrade the license.`,
            seat_usage: seatUsage,
          },
          { status: 403 }
        );
      }
    }

    await client.query(
      `UPDATE users
          SET status = $3,
              updated_at = NOW()
        WHERE id = $1
          AND business_id = $2`,
      [userId, businessId, desired]
    );

    const action = desired === "disabled" ? "user.disable" : "user.enable";
    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, $2, $3, 'user', $4::text, $5::jsonb)`,
      [businessId, actorUserId, action, String(userId), JSON.stringify({ from: current, to: desired })]
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, user_id: userId, status: desired });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PUT /api/admin/users/[id]/status failed:", err);
    return NextResponse.json({ error: "Failed to update user status" }, { status: 500 });
  } finally {
    client.release();
  }
}

