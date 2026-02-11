export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

type Body = {
  role_code?: string;
};

export async function PUT(req: NextRequest, { params }: { params: { client_uid: string } }) {
  const access = await requireAnyPermission(req, ["perm.users.manage"], "Forbidden");
  if ("response" in access) return access.response;

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const actorUserId = access.ctx.userId > 0 ? access.ctx.userId : getRequestUserId(req, 1);
  const clientUid = String(params.client_uid || "").trim();
  if (!clientUid) {
    return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const roleCode = String(body.role_code || "").trim().toLowerCase();
  if (!roleCode) {
    return NextResponse.json({ error: "role_code is required" }, { status: 400 });
  }

  const roleRs = await pool.query(
    `SELECT code
       FROM roles
      WHERE (business_id = $1 OR business_id IS NULL)
        AND lower(code) = $2
      ORDER BY business_id NULLS LAST
      LIMIT 1`,
    [businessId, roleCode]
  );
  if (roleRs.rowCount === 0) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }

  const effectiveRole = String(roleRs.rows[0].code);
  const rs = await pool.query(
    `UPDATE lan_clients
        SET role_code = $3,
            updated_at = NOW()
      WHERE business_id = $1
        AND client_uid = $2
      RETURNING client_uid, role_code, status`,
    [businessId, clientUid, effectiveRole]
  );

  if (rs.rowCount === 0) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  await pool.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
     VALUES ($1, $2, 'lan.client.role.update', 'lan_clients', $3, $4::jsonb)`,
    [businessId, actorUserId, clientUid, JSON.stringify({ role_code: effectiveRole })]
  );

  return NextResponse.json({
    ok: true,
    client_uid: rs.rows[0].client_uid,
    role_code: rs.rows[0].role_code,
    status: rs.rows[0].status,
  });
}
