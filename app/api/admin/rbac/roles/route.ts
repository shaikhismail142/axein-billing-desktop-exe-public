export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

type CreateBody = {
  code?: string;
  name?: string;
  revenue_visible?: boolean;
};

function normalizeRoleCode(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export async function GET(req: Request) {
  const access = await requireAnyPermission(req, ["perm.roles.manage", "perm.users.manage"], "Forbidden");
  if ("response" in access) return access.response;

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);

  const [rolesRs, permsRs] = await Promise.all([
    pool.query(
      `SELECT
          r.id,
          r.business_id,
          r.code,
          r.name,
          r.is_system,
          r.revenue_visible,
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object('code', p.code, 'label', p.label)
            ) FILTER (WHERE p.id IS NOT NULL),
            '[]'::json
          ) AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.allow = TRUE
         LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE r.business_id = $1 OR r.business_id IS NULL
        GROUP BY r.id
        ORDER BY r.business_id NULLS LAST, r.code ASC`,
      [businessId]
    ),
    pool.query(
      `SELECT id, code, label, description
         FROM permissions
        ORDER BY code ASC`
    ),
  ]);

  return NextResponse.json({
    business_id: businessId,
    roles: rolesRs.rows || [],
    permission_catalog: permsRs.rows || [],
  });
}

export async function POST(req: Request) {
  const access = await requireAnyPermission(req, ["perm.roles.manage"], "Forbidden");
  if ("response" in access) return access.response;

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const actorUserId = access.ctx.userId > 0 ? access.ctx.userId : getRequestUserId(req, 1);

  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const name = String(body.name || "").trim().slice(0, 80);
  const code = normalizeRoleCode(String(body.code || name));
  const revenueVisible = body.revenue_visible === true;

  if (!name || !code) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const exists = await client.query(
      `SELECT id
         FROM roles
        WHERE lower(code) = lower($1)
          AND (business_id = $2 OR business_id IS NULL)
        LIMIT 1`,
      [code, businessId]
    );
    if (exists.rowCount > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: `Role code already exists: ${code}` }, { status: 409 });
    }

    const ins = await client.query(
      `INSERT INTO roles (business_id, code, name, is_system, revenue_visible)
       VALUES ($1, $2, $3, FALSE, $4)
       RETURNING id, business_id, code, name, is_system, revenue_visible`,
      [businessId, code, name, revenueVisible]
    );
    const role = ins.rows?.[0] || null;

    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, $2, 'role.create', 'role', $3::text, $4::jsonb)`,
      [businessId, actorUserId, String(role?.id || ""), JSON.stringify({ code, name, revenue_visible: revenueVisible })]
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, role }, { status: 201 });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/admin/rbac/roles failed:", err);
    return NextResponse.json({ error: "Failed to create role" }, { status: 500 });
  } finally {
    client.release();
  }
}
