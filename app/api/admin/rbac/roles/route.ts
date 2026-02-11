export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

export async function GET(req: Request) {
  const access = await requireAnyPermission(req, ["perm.roles.manage", "perm.users.manage"], "Forbidden");
  if (!access.ok) return access.response;

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
