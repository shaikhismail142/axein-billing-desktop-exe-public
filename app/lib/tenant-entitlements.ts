import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isSaasDeployment } from "@/app/lib/deployment";

export type TenantEntitlement = {
  status: "draft" | "active" | "read_only" | "suspended" | "expired";
  readOnly: boolean;
  modules: string[];
  userLimit: number;
  startsAt: string | null;
  endsAt: string | null;
};

export async function getTenantEntitlement(businessId: number): Promise<TenantEntitlement> {
  if (!isSaasDeployment()) {
    return { status: "active", readOnly: false, modules: ["*"], userLimit: 999, startsAt: null, endsAt: null };
  }
  const rs = await pool.query(
    `SELECT e.status, b.tenant_status, e.starts_at, e.ends_at, e.user_limit, e.modules, e.read_only_after_expiry,
            CASE WHEN ends_at IS NOT NULL AND ends_at <= NOW() THEN TRUE ELSE FALSE END AS date_expired,
            CASE WHEN starts_at IS NOT NULL AND starts_at > NOW() THEN TRUE ELSE FALSE END AS not_started
       FROM tenant_entitlements e
       JOIN businesses b ON b.id = e.business_id
      WHERE e.business_id = $1
      LIMIT 1`,
    [businessId]
  );
  if (!rs.rowCount) {
    return { status: "suspended", readOnly: true, modules: [], userLimit: 0, startsAt: null, endsAt: null };
  }
  const row = rs.rows[0] as any;
  const expired = Boolean(row.date_expired);
  const tenantStatus = String(row.tenant_status || "active");
  const configuredStatus = String(row.status);
  const blocked = Boolean(row.not_started)
    || ["draft", "suspended"].includes(configuredStatus)
    || ["draft", "suspended", "inactive"].includes(tenantStatus);
  const status = expired
    ? "expired"
    : blocked
    ? "suspended"
    : (configuredStatus as TenantEntitlement["status"]);
  return {
    status,
    readOnly: blocked || status === "read_only" || (expired && Boolean(row.read_only_after_expiry)),
    modules: Array.isArray(row.modules) ? row.modules.map(String) : [],
    userLimit: Number(row.user_limit || 0),
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
  };
}

export async function enforceTenantWriteAccess(businessId: number): Promise<NextResponse | null> {
  const entitlement = await getTenantEntitlement(businessId);
  if (!entitlement.readOnly) return null;
  return NextResponse.json(
    {
      error: "tenant_read_only",
      message: entitlement.status === "expired"
        ? "This plan has expired. Viewing, printing and exports remain available. Contact AxEin to renew."
        : "This workspace is currently read-only. Contact AxEin support.",
      entitlement,
    },
    { status: 403 }
  );
}

const PERMISSION_MODULES: Array<[string, string[]]> = [
  ["perm.sales.", ["billing", "invoices"]],
  ["perm.payments.", ["billing", "invoices", "accounting"]],
  ["perm.quotations.", ["quotations"]],
  ["perm.products.", ["products"]],
  ["perm.inventory.", ["inventory"]],
  ["perm.purchases.", ["purchases"]],
  ["perm.reports.", ["reports", "dashboard", "accounting"]],
  ["perm.audit.", ["audit"]],
  ["perm.automotive.", ["automotive", "billing"]],
];

export async function enforceTenantModuleAccess(businessId: number, permissions: string[]): Promise<NextResponse | null> {
  const entitlement = await getTenantEntitlement(businessId);
  if (entitlement.modules.includes("*")) return null;
  const required = permissions.flatMap((permission) =>
    PERMISSION_MODULES.find(([prefix]) => permission.startsWith(prefix))?.[1] || []
  );
  if (required.length === 0 || required.some((module) => entitlement.modules.includes(module))) return null;
  return NextResponse.json({ error: "module_not_enabled", required_modules: [...new Set(required)] }, { status: 403 });
}
