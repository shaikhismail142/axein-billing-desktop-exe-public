export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAuthenticated } from "@/app/lib/request-access";
import { getTenantEntitlement } from "@/app/lib/tenant-entitlements";
import { resolveBusinessTemplate, resolveTemplateNavigationItems, type TemplateNavItem } from "@/app/lib/business-templates";
import { getUserPermissionCodes, getUserRoles } from "@/app/lib/platform-rbac";

const NAV_PERMISSIONS: Partial<Record<TemplateNavItem["key"], string[]>> = {
  dashboard: ["perm.reports.view", "perm.view.revenue_summary"],
  billing: ["perm.sales.manage"],
  invoices: ["perm.sales.manage", "perm.payments.manage", "perm.export.manage"],
  quotations: ["perm.quotations.manage"],
  products: ["perm.products.manage"],
  inventory: ["perm.inventory.manage"],
  purchases: ["perm.purchases.manage"],
  accounting: ["perm.payments.manage", "perm.reports.view"],
  profile: ["perm.settings.manage", "perm.users.manage", "perm.users.approve", "perm.roles.manage", "perm.audit.view"],
};

function normalizeNavItems(items: unknown): TemplateNavItem[] {
  if (!Array.isArray(items)) return [];
  const out: TemplateNavItem[] = [];
  for (const row of items) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const key = String(item.key || "").trim();
    const label = String(item.label || "").trim();
    const href = String(item.href || "").trim();
    if (!key || !label || !href) continue;
    out.push({
      key: key as TemplateNavItem["key"],
      label,
      href,
    });
  }
  return out;
}

export async function GET(req: Request) {
  const access = await requireAuthenticated(req);
  if ("response" in access) return access.response;
  const businessId = access.ctx.businessId;

  const [bizRs, policyRs, roles, permissions] = await Promise.all([
    pool.query(
      `SELECT id, code, name, business_type
         FROM businesses
        WHERE id = $1
        LIMIT 1`,
      [businessId]
    ),
    pool.query(
      `SELECT policy_json
         FROM module_policies
        WHERE business_id = $1
          AND module_key = 'navigation'
        LIMIT 1`,
      [businessId]
    ),
    getUserRoles(access.ctx.userId, businessId),
    getUserPermissionCodes(access.ctx.userId, businessId),
  ]);

  const business = bizRs.rows?.[0] || null;
  const businessType = String(business?.business_type || "general_store");
  const template = resolveBusinessTemplate(businessType);

  const policy = policyRs.rows?.[0]?.policy_json;
  const fromPolicy = normalizeNavItems((policy as any)?.navigation_items);
  const configuredItems = fromPolicy.length > 0 ? fromPolicy : resolveTemplateNavigationItems(template.key);
  const entitlement = await getTenantEntitlement(businessId);
  const entitledItems = entitlement.modules.includes("*")
    ? configuredItems
    : configuredItems.filter((item) => entitlement.modules.includes(item.key));
  const roleCodes = new Set(roles.map((role) => role.code.toLowerCase()));
  const elevated = roleCodes.has("owner") || roleCodes.has("admin") || roleCodes.has("platform_admin");
  const granted = new Set(permissions);
  const items = elevated
    ? entitledItems
    : entitledItems.filter((item) => (NAV_PERMISSIONS[item.key] || []).some((permission) => granted.has(permission)));

  return NextResponse.json({
    business_id: businessId,
    business_code: business?.code || null,
    business_name: business?.name || null,
    business_type: template.key,
    template_label: template.label,
    workflow_hints: (policy as any)?.workflow_hints || template.workflowHints,
    invoice_layout: (policy as any)?.invoice_layout || template.invoiceLayout,
    items,
    entitlement,
  });
}
