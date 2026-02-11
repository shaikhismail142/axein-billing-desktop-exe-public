export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId } from "@/app/lib/platform-context";
import { resolveBusinessTemplate, resolveTemplateNavigationItems, type TemplateNavItem } from "@/app/lib/business-templates";

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
  const businessId = getRequestBusinessId(req, 1);

  const [bizRs, policyRs] = await Promise.all([
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
  ]);

  const business = bizRs.rows?.[0] || null;
  const businessType = String(business?.business_type || "general_store");
  const template = resolveBusinessTemplate(businessType);

  const policy = policyRs.rows?.[0]?.policy_json;
  const fromPolicy = normalizeNavItems((policy as any)?.navigation_items);
  const items = fromPolicy.length > 0 ? fromPolicy : resolveTemplateNavigationItems(template.key);

  return NextResponse.json({
    business_id: businessId,
    business_code: business?.code || null,
    business_name: business?.name || null,
    business_type: template.key,
    template_label: template.label,
    workflow_hints: (policy as any)?.workflow_hints || template.workflowHints,
    invoice_layout: (policy as any)?.invoice_layout || template.invoiceLayout,
    items,
  });
}
