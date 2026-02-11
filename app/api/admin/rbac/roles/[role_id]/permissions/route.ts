export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

type Body = {
  permission_codes?: string[];
};

function normalizeCodes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const row of input) {
    const code = String(row || "").trim();
    if (code) out.add(code);
  }
  return [...out];
}

export async function PUT(req: Request, { params }: { params: { role_id: string } }) {
  const access = await requireAnyPermission(req, ["perm.roles.manage"], "Forbidden");
  if ("response" in access) return access.response;

  const roleId = Number(params.role_id || 0);
  if (!Number.isFinite(roleId) || roleId <= 0) {
    return NextResponse.json({ error: "Invalid role id" }, { status: 400 });
  }

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const actorUserId = access.ctx.userId > 0 ? access.ctx.userId : getRequestUserId(req, 1);
  const body = (await req.json().catch(() => ({}))) as Body;
  const permissionCodes = normalizeCodes(body.permission_codes);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const roleRs = await client.query(
      `SELECT id, code, name
         FROM roles
        WHERE id = $1
          AND (business_id = $2 OR business_id IS NULL)
        LIMIT 1
        FOR UPDATE`,
      [roleId, businessId]
    );
    if (roleRs.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    const permRs = await client.query(
      `SELECT id, code
         FROM permissions
        WHERE code = ANY($1::text[])`,
      [permissionCodes]
    );
    const permIds = permRs.rows.map((r: any) => Number(r.id));

    await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);
    for (const permId of permIds) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id, allow)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (role_id, permission_id)
         DO UPDATE SET allow = EXCLUDED.allow`,
        [roleId, permId]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, $2, 'role.permissions.update', 'role', $3::text, $4::jsonb)`,
      [businessId, actorUserId, roleId, JSON.stringify({ permission_codes: permissionCodes })]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      role_id: roleId,
      permission_codes: permRs.rows.map((r: any) => String(r.code)),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PUT /api/admin/rbac/roles/[role_id]/permissions failed:", err);
    return NextResponse.json({ error: "Failed to update role permissions" }, { status: 500 });
  } finally {
    client.release();
  }
}
