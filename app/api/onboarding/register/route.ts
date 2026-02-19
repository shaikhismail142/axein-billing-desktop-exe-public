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
  computer_limit?: number;
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

function isMissingComputerLimitColumn(err: unknown) {
  const message = String((err as { message?: string } | null)?.message || "").toLowerCase();
  return message.includes("computer_limit") && message.includes("does not exist");
}

const BOOTSTRAP_SAMPLE_PRODUCT_SKUS = [
  "PVC-ELB-12",
  "ANG-VAL-CHR",
  "MIR-24x18",
  "PTFE-001",
];

async function clearBootstrapSampleProducts(client: any, businessId: number) {
  if (!Number.isFinite(businessId) || businessId <= 0) return;
  const columnRs = await client.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name = 'business_id'
      LIMIT 1`
  );
  const hasBusinessColumn = columnRs.rowCount > 0;
  if (hasBusinessColumn) {
    await client.query(
      `DELETE FROM products
        WHERE business_id = $1
          AND sku = ANY($2::text[])`,
      [businessId, BOOTSTRAP_SAMPLE_PRODUCT_SKUS]
    );
    return;
  }
  await client.query(
    `DELETE FROM products
      WHERE sku = ANY($1::text[])`,
    [BOOTSTRAP_SAMPLE_PRODUCT_SKUS]
  );
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as RegisterBody;

  const businessName = String(body.business_name || "").trim();
  const businessType = String(body.business_type || "").trim();
  const usageMode = body.usage_mode === "lan_host" ? "lan_host" : "standalone";
  const userLimit = safeInt(body.user_limit, 5);
  const defaultComputerLimit = usageMode === "lan_host" ? 3 : 1;
  const computerLimit = safeInt(body.computer_limit, defaultComputerLimit);
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

    const bootstrapBusinessRs = await client.query(
      `SELECT b.id
         FROM businesses b
         LEFT JOIN users u ON u.business_id = b.id
        WHERE b.is_active = TRUE
        GROUP BY b.id
       HAVING COUNT(u.id) = 0
        ORDER BY b.id ASC
        LIMIT 1`
    );
    const bootstrapBusinessId = Number(bootstrapBusinessRs.rows?.[0]?.id || 0);

    // Prevent users from registering additional businesses on an already-initialized install.
    // Fresh installs either have 0 businesses, or a single "bootstrap" business with 0 users.
    if (bootstrapBusinessId <= 0) {
      const existingActive = await client.query(
        `SELECT id
           FROM businesses
          WHERE is_active = TRUE
          LIMIT 1`
      );
      if (existingActive.rowCount > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error:
              "Business is already registered on this install. New business registration is restricted to AxEin onboarding.",
          },
          { status: 409 }
        );
      }
    }

    const codeCandidateRs = await client.query(
      `SELECT COUNT(*)::int AS cnt
         FROM businesses
        WHERE code = $1
          AND ($2::bigint IS NULL OR id <> $2)`,
      [codeBase, bootstrapBusinessId > 0 ? bootstrapBusinessId : null]
    );
    const cnt = Number(codeCandidateRs.rows?.[0]?.cnt || 0);
    const code = cnt > 0 ? `${codeBase}-${Date.now().toString().slice(-6)}` : codeBase;

    let businessRs;
    if (bootstrapBusinessId > 0) {
      try {
        businessRs = await client.query(
          `UPDATE businesses
              SET code = $2,
                  name = $3,
                  business_type = $4,
                  user_limit = $5,
                  computer_limit = $6,
                  license_plan_intent = $7,
                  usage_mode = $8,
                  config_json = $9::jsonb,
                  is_active = TRUE,
                  updated_at = NOW()
            WHERE id = $1
          RETURNING id, code, name, business_type, user_limit, computer_limit`,
          [
            bootstrapBusinessId,
            code,
            businessName,
            businessType,
            userLimit,
            Math.max(1, computerLimit),
            body.license_plan_intent || null,
            usageMode,
            JSON.stringify({ template: template.key, template_version: 1 }),
          ]
        );
      } catch (err) {
        if (!isMissingComputerLimitColumn(err)) throw err;
        businessRs = await client.query(
          `UPDATE businesses
              SET code = $2,
                  name = $3,
                  business_type = $4,
                  user_limit = $5,
                  license_plan_intent = $6,
                  usage_mode = $7,
                  config_json = $8::jsonb,
                  is_active = TRUE,
                  updated_at = NOW()
            WHERE id = $1
          RETURNING id, code, name, business_type, user_limit`,
          [
            bootstrapBusinessId,
            code,
            businessName,
            businessType,
            userLimit,
            body.license_plan_intent || null,
            usageMode,
            JSON.stringify({ template: template.key, template_version: 1 }),
          ]
        );
      }
    } else {
      try {
        businessRs = await client.query(
          `INSERT INTO businesses
             (code, name, business_type, user_limit, computer_limit, license_plan_intent, usage_mode, config_json)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
           RETURNING id, code, name, business_type, user_limit, computer_limit`,
          [
            code,
            businessName,
            businessType,
            userLimit,
            Math.max(1, computerLimit),
            body.license_plan_intent || null,
            usageMode,
            JSON.stringify({ template: template.key, template_version: 1 }),
          ]
        );
      } catch (err) {
        if (!isMissingComputerLimitColumn(err)) throw err;
        businessRs = await client.query(
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
      }
    }
    const business = businessRs.rows[0];

    // Fresh desktop installs may contain seed SKUs from legacy migrations.
    // Remove only known sample SKUs when finalizing the bootstrap business.
    if (bootstrapBusinessId > 0) {
      try {
        await clearBootstrapSampleProducts(client, Number(business.id || bootstrapBusinessId));
      } catch (e) {
        console.warn("Bootstrap sample product cleanup skipped:", e);
      }
    }

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

    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id, allow)
       SELECT br.id, rp.permission_id, rp.allow
         FROM roles br
         JOIN roles sr
           ON sr.business_id IS NULL
          AND lower(sr.code) = lower(br.code)
         JOIN role_permissions rp
           ON rp.role_id = sr.id
        WHERE br.business_id = $1
       ON CONFLICT (role_id, permission_id)
       DO UPDATE SET allow = EXCLUDED.allow`,
      [business.id]
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
       VALUES ($1, $2, 'business.register', 'business', $3::text, $4::jsonb)`,
      [
        business.id,
        owner.id,
        String(business.id),
        JSON.stringify({
          business_type: businessType,
          user_limit: userLimit,
          computer_limit: Math.max(1, computerLimit),
        }),
      ]
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
