export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

export async function POST(req: NextRequest, { params }: { params: { client_uid: string } }) {
  const access = await requireAnyPermission(req, ["perm.users.approve", "perm.users.manage"], "Forbidden");
  if ("response" in access) return access.response;

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const actorUserId = access.ctx.userId > 0 ? access.ctx.userId : getRequestUserId(req, 1);
  const clientUid = String(params.client_uid || "").trim();
  if (!clientUid) {
    return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
  }

  const rs = await pool.query(
    `UPDATE lan_clients
        SET status = 'active',
            updated_at = NOW()
      WHERE business_id = $1
        AND client_uid = $2
      RETURNING client_uid, status`,
    [businessId, clientUid]
  );

  if (rs.rowCount === 0) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  await pool.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
     VALUES ($1, $2, 'lan.client.approve', 'lan_clients', $3, '{}'::jsonb)`,
    [businessId, actorUserId, clientUid]
  );

  return NextResponse.json({ ok: true, client_uid: rs.rows[0].client_uid, status: rs.rows[0].status });
}
