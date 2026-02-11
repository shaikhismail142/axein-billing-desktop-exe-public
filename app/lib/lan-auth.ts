import { pool } from "@/lib/db";
import { hashWithSecret, safeEqHex } from "@/app/lib/lan-crypto";

export type LanClientAuth = {
  ok: true;
  businessId: number;
  clientUid: string;
  roleCode: string;
  permissions: string[];
  revenueVisible: boolean;
} | {
  ok: false;
  reason: string;
};

async function getRolePermissions(businessId: number, roleCode: string) {
  const roleRs = await pool.query(
    `SELECT id, revenue_visible
       FROM roles
      WHERE (business_id = $1 OR business_id IS NULL)
        AND lower(code) = lower($2)
      ORDER BY business_id NULLS LAST
      LIMIT 1`,
    [businessId, roleCode]
  );

  if (roleRs.rowCount === 0) {
    return { permissions: [] as string[], revenueVisible: false };
  }

  const roleId = roleRs.rows[0].id;
  const revenueVisible = Boolean(roleRs.rows[0].revenue_visible);

  const permRs = await pool.query(
    `SELECT p.code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1
        AND rp.allow = TRUE
      ORDER BY p.code ASC`,
    [roleId]
  );

  return {
    permissions: permRs.rows.map((r: any) => String(r.code)),
    revenueVisible,
  };
}

export async function authenticateLanClient(req: Request): Promise<LanClientAuth> {
  const clientUid = String(req.headers.get("x-lan-client-id") || "").trim();
  const token = String(req.headers.get("x-lan-token") || "").trim();

  if (!clientUid || !token) {
    return { ok: false, reason: "missing_headers" };
  }

  const rs = await pool.query(
    `SELECT c.business_id, c.client_uid, c.role_code, c.token_hash, c.status, h.host_secret
       FROM lan_clients c
       JOIN lan_host_configs h ON h.business_id = c.business_id
      WHERE c.client_uid = $1
      LIMIT 1`,
    [clientUid]
  );

  if (rs.rowCount === 0) {
    return { ok: false, reason: "client_not_found" };
  }

  const row = rs.rows[0];
  if (String(row.status || "").toLowerCase() !== "active") {
    return { ok: false, reason: "client_inactive" };
  }

  const candidate = hashWithSecret(token, String(row.host_secret || ""));
  const ok = safeEqHex(candidate, String(row.token_hash || ""));
  if (!ok) {
    return { ok: false, reason: "token_invalid" };
  }

  const businessId = Number(row.business_id || 0);
  const roleCode = String(row.role_code || "billing_staff");
  const perms = await getRolePermissions(businessId, roleCode);

  await pool.query(
    `UPDATE lan_clients
        SET last_seen_at = NOW(),
            updated_at = NOW()
      WHERE client_uid = $1`,
    [clientUid]
  );

  return {
    ok: true,
    businessId,
    clientUid,
    roleCode,
    permissions: perms.permissions,
    revenueVisible: perms.revenueVisible,
  };
}
