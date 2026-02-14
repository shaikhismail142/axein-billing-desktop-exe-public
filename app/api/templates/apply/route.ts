export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAnyPermission } from "@/app/lib/request-access";
import {
  isBusinessType,
  resolveBusinessTemplate,
  resolveTemplateNavigationItems,
} from "@/app/lib/business-templates";

type ApplyBody = {
  business_type?: string;
  invoice_layout?: "a4" | "thermal" | "hybrid";
  reset?: boolean;
};

function isInvoiceLayout(v: unknown): v is "a4" | "thermal" | "hybrid" {
  return v === "a4" || v === "thermal" || v === "hybrid";
}

export async function POST(req: Request) {
  const access = await requireAnyPermission(
    req,
    ["perm.settings.manage", "perm.invoice.custom_fields.manage"],
    "Forbidden"
  );
  if ("response" in access) return access.response;

  const body = (await req.json().catch(() => ({}))) as ApplyBody;
  const businessTypeRaw = String(body.business_type || "").trim();
  const reset = body.reset === true;

  const template = resolveBusinessTemplate(isBusinessType(businessTypeRaw) ? businessTypeRaw : undefined);
  const invoiceLayout = isInvoiceLayout(body.invoice_layout) ? body.invoice_layout : template.invoiceLayout;
  const navItems = resolveTemplateNavigationItems(template.key);

  const businessId = access.ctx.businessId;
  const actorUserId = access.ctx.userId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const bizRs = await client.query(
      `SELECT config_json, template_version
         FROM businesses
        WHERE id = $1
        LIMIT 1`,
      [businessId]
    );
    const existingConfig = bizRs.rows?.[0]?.config_json;
    const prevVersion = Number(bizRs.rows?.[0]?.template_version || 1);
    const nextVersion = Number.isFinite(prevVersion) && prevVersion > 0 ? prevVersion + 1 : 2;

    const nextConfig =
      existingConfig && typeof existingConfig === "object"
        ? { ...existingConfig, template: template.key, template_version: nextVersion }
        : { template: template.key, template_version: nextVersion };

    await client.query(
      `UPDATE businesses
          SET business_type = $2,
              config_json = $3::jsonb,
              template_version = $4,
              updated_at = NOW()
        WHERE id = $1`,
      [businessId, template.key, JSON.stringify(nextConfig), nextVersion]
    );

    await client.query(
      `INSERT INTO module_policies (business_id, module_key, policy_json)
       VALUES ($1, 'navigation', $2::jsonb)
       ON CONFLICT (business_id, module_key)
       DO UPDATE SET policy_json = EXCLUDED.policy_json, updated_at = NOW()`,
      [
        businessId,
        JSON.stringify({
          template: template.key,
          navigation: template.navigation,
          navigation_items: navItems,
          invoice_layout: invoiceLayout,
          workflow_hints: template.workflowHints,
        }),
      ]
    );

    if (reset) {
      // Hide previous template-provisioned fields (never delete; preserves data history).
      await client.query(
        `UPDATE invoice_custom_fields
            SET visible = FALSE,
                required = FALSE,
                updated_at = NOW()
          WHERE business_id = $1
            AND preset_scope IS NOT NULL
            AND preset_scope <> $2`,
        [businessId, template.key]
      );
    }

    for (const [idx, field] of template.defaultInvoiceFields.entries()) {
      await client.query(
        `INSERT INTO invoice_custom_fields
          (business_id, field_key, label, data_type, required, visible, position, applies_to, preset_scope, config_json)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, 'invoice', $8, $9::jsonb)
         ON CONFLICT (business_id, field_key)
         DO UPDATE SET
            label = EXCLUDED.label,
            data_type = EXCLUDED.data_type,
            required = EXCLUDED.required,
            visible = EXCLUDED.visible,
            position = EXCLUDED.position,
            preset_scope = EXCLUDED.preset_scope,
            config_json = EXCLUDED.config_json,
            updated_at = NOW()`,
        [
          businessId,
          field.key,
          field.label,
          field.data_type || "text",
          field.required,
          field.visible,
          idx + 1,
          template.key,
          JSON.stringify({ source: reset ? "template_reset" : "template_apply" }),
        ]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, $2, 'template.apply', 'business', $3::text, $4::jsonb)`,
      [
        businessId,
        actorUserId > 0 ? actorUserId : null,
        String(businessId),
        JSON.stringify({
          business_type: template.key,
          invoice_layout: invoiceLayout,
          reset,
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      template: {
        key: template.key,
        label: template.label,
        invoice_layout: invoiceLayout,
        navigation_items: navItems,
        workflow_hints: template.workflowHints,
      },
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("POST /api/templates/apply failed:", err);
    return NextResponse.json({ ok: false, error: "Failed to apply template" }, { status: 500 });
  } finally {
    client.release();
  }
}

