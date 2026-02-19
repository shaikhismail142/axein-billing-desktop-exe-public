import { pool } from "@/lib/db";

export type RoleSummary = {
  id: number;
  code: string;
  name: string;
  revenue_visible: boolean;
};

export async function getUserRoles(userId: number, businessId: number): Promise<RoleSummary[]> {
  const rs = await pool.query(
    `SELECT r.id, r.code, r.name, r.revenue_visible
       FROM user_role_map m
       JOIN roles r ON r.id = m.role_id
      WHERE m.user_id = $1
        AND (r.business_id = $2 OR r.business_id IS NULL)
      ORDER BY r.id ASC`,
    [userId, businessId]
  );
  return rs.rows || [];
}

export async function getUserPermissionCodes(userId: number, businessId: number): Promise<string[]> {
  const roleRs = await pool.query(
    `SELECT DISTINCT LOWER(r.code) AS code
       FROM user_role_map m
       JOIN roles r ON r.id = m.role_id
      WHERE m.user_id = $1
        AND (r.business_id = $2 OR r.business_id IS NULL)`,
    [userId, businessId]
  );
  const roleCodes = new Set<string>((roleRs.rows || []).map((r: any) => String(r.code || "").toLowerCase()));

  const rs = await pool.query(
    `SELECT DISTINCT p.code
       FROM user_role_map m
       JOIN roles r ON r.id = m.role_id
       JOIN role_permissions rp ON rp.role_id = r.id AND rp.allow = TRUE
       JOIN permissions p ON p.id = rp.permission_id
      WHERE m.user_id = $1
        AND (r.business_id = $2 OR r.business_id IS NULL)
      ORDER BY p.code ASC`,
    [userId, businessId]
  );
  const perms = rs.rows.map((r: any) => String(r.code));

  // Defensive fallback: admin/owner should retain module access even if RBAC mappings are incomplete.
  if (roleCodes.has("owner") || roleCodes.has("admin")) {
    const all = await pool.query(`SELECT code FROM permissions ORDER BY code ASC`);
    return (all.rows || []).map((r: any) => String(r.code));
  }

  return perms;
}

export function canViewBusinessRevenue(roles: RoleSummary[], permissionCodes: string[]): boolean {
  if (permissionCodes.includes("perm.view.revenue_summary")) return true;
  return roles.some((r) => {
    const code = String(r.code).toLowerCase();
    if (code === "owner") return true;
    return r.revenue_visible === true && code === "admin";
  });
}
