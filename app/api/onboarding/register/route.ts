export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";
import {
  isBusinessType,
  resolveBusinessTemplate,
  resolveTemplateNavigationItems,
} from "@/app/lib/business-templates";

type RegisterBody = {
  business_name?: string;
  business_type?: string;
  user_limit?: number;
  license_plan_intent?: string;
  usage_mode?: "standalone" | "lan_host";
  owner?: {
    full_name?: string;
    email?: string;
    phone?: string;
    password?: string;
  };
};

function normalizeCode(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function safeInt(v: unknown, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as RegisterBody;

  const businessName = String(body.business_name || "").trim();
  const businessType = String(body.business_type || "").trim();
  const usageMode = body.usage_mode === "lan_host" ? "lan_host" : "standalone";
  const userLimit = safeInt(body.user_limit, 5);
  const ownerName = String(body.owner?.full_name || "").trim();
  const ownerEmail = String(body.owner?.email || "").trim().toLowerCase();
  const ownerPhone = String(body.owner?.phone || "").trim() || null;
  const ownerPassword = String(body.owner?.password || "");

  if (!businessName) {
    return NextResponse.json({ error: "business_name is required" }, { status: 400 });
  }
  if (!isBusinessType(businessType)) {
    return NextResponse.json({ error: "business_type is invalid" }, { status: 400 });
  }
  if (!ownerName || !ownerEmail || ownerPassword.length < 6) {
    return NextResponse.json(
      { error: "owner.full_name, owner.email, owner.password(min 6 chars) are required" },
      { status: 400 }
    );
  }

  const template = resolveBusinessTemplate(businessType);
  const templateNavItems = resolveTemplateNavigationItems(template.key);
  const codeBase = normalizeCode(businessName) || "axein-business";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const codeCandidateRs = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM businesses WHERE code = $1`,
      [codeBase]
    );
    const cnt = Number(codeCandidateRs.rows?.[0]?.cnt || 0);
    const code = cnt > 0 ? `${codeBase}-${Date.now().toString().slice(-6)}` : codeBase;

    const businessRs = await client.query(
      `INSERT INTO businesses
         (code, name, business_type, user_limit, license_plan_intent, usage_mode, config_json)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, code, name, business_type, user_limit`,
      [
        code,
        businessName,
        businessType,
        userLimit,
        body.license_plan_intent || null,
        usageMode,
        JSON.stringify({ template: template.key, template_version: 1 }),
      ]
    );
    const business = businessRs.rows[0];

    await client.query(
      `INSERT INTO module_policies (business_id, module_key, policy_json)
       VALUES ($1, 'navigation', $2::jsonb)
       ON CONFLICT (business_id, module_key)
       DO UPDATE SET policy_json = EXCLUDED.policy_json, updated_at = NOW()`,
      [
        business.id,
        JSON.stringify({
          template: template.key,
          navigation: template.navigation,
          navigation_items: templateNavItems,
          invoice_layout: template.invoiceLayout,
          workflow_hints: template.workflowHints,
        }),
      ]
    );

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
            config_json = EXCLUDED.config_json,
            updated_at = NOW()`,
        [
          business.id,
          field.key,
          field.label,
          field.data_type || "text",
          field.required,
          field.visible,
          idx + 1,
          template.key,
          JSON.stringify({ source: "template_onboarding" }),
        ]
      );
    }

    await client.query(
      `INSERT INTO roles (business_id, code, name, is_system, revenue_visible, default_for_type)
       SELECT $1, r.code, r.name, r.is_system, r.revenue_visible, $2
         FROM roles r
        WHERE r.business_id IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM roles x
             WHERE x.business_id = $1
               AND lower(x.code) = lower(r.code)
          )`,
      [business.id, businessType]
    );

    const passwordHash = await bcrypt.hash(ownerPassword, 10);

    const ownerUserRs = await client.query(
      `INSERT INTO users
        (business_id, full_name, email, phone, password_hash, status, is_system_admin, approved_at)
       VALUES
        ($1, $2, $3, $4, $5, 'active', TRUE, NOW())
       RETURNING id, full_name, email, status`,
      [business.id, ownerName, ownerEmail, ownerPhone, passwordHash]
    );
    const owner = ownerUserRs.rows[0];

    const ownerRoleRs = await client.query(
      `SELECT id FROM roles WHERE business_id = $1 AND lower(code) = 'owner' LIMIT 1`,
      [business.id]
    );
    const adminRoleRs = await client.query(
      `SELECT id FROM roles WHERE business_id = $1 AND lower(code) = 'admin' LIMIT 1`,
      [business.id]
    );

    if (ownerRoleRs.rowCount > 0) {
      await client.query(
        `INSERT INTO user_role_map (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [owner.id, ownerRoleRs.rows[0].id]
      );
    }
    if (adminRoleRs.rowCount > 0) {
      await client.query(
        `INSERT INTO user_role_map (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [owner.id, adminRoleRs.rows[0].id]
      );
    }

    await client.query(
      `INSERT INTO approvals (business_id, user_id, request_type, status, requested_by, decided_by, decided_at, meta)
       VALUES ($1, $2, 'owner_registration', 'approved', $2, $2, NOW(), $3::jsonb)`,
      [business.id, owner.id, JSON.stringify({ source: "onboarding" })]
    );

    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, $2, 'business.register', 'business', $1::text, $3::jsonb)`,
      [business.id, owner.id, JSON.stringify({ business_type: businessType, user_limit: userLimit })]
    );

    await client.query("COMMIT");

    return NextResponse.json(
      {
        ok: true,
        business,
        owner,
        template,
      },
      { status: 201 }
    );
  } catch (err: any) {
    await client.query("ROLLBACK");
    const message = String(err?.message || "Failed to register business");
    console.error("POST /api/onboarding/register failed:", err);
    if (message.includes("users_business_email_uq") || message.includes("duplicate")) {
      return NextResponse.json({ error: "Business or owner already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to register business" }, { status: 500 });
  } finally {
    client.release();
  }
}
