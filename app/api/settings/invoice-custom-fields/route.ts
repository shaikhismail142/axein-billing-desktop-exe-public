export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";
import {
  CustomFieldAppliesTo,
  CustomFieldDataType,
  normalizeCustomFieldAppliesTo,
  normalizeCustomFieldConfig,
  normalizeCustomFieldDataType,
} from "@/app/lib/custom-fields";

type CustomFieldBody = {
  id?: number;
  field_key?: string;
  label?: string;
  data_type?: CustomFieldDataType;
  required?: boolean;
  visible?: boolean;
  position?: number;
  applies_to?: CustomFieldAppliesTo;
  config_json?: Record<string, unknown>;
};

function normalizeFieldKey(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function normalizePosition(input: unknown, fallback = 100) {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(9999, Math.floor(n)));
}

export async function GET(req: Request) {
  const businessId = getRequestBusinessId(req, 1);
  const url = new URL(req.url);
  const appliesRaw = String(url.searchParams.get("applies_to") || "").trim().toLowerCase();
  const appliesTo = appliesRaw && appliesRaw !== "all" ? normalizeCustomFieldAppliesTo(appliesRaw) : null;
  const visibleOnly = url.searchParams.get("visible") === "1";

  const params: any[] = [businessId];
  let where = "business_id = $1";
  if (appliesTo) {
    params.push(appliesTo);
    where += ` AND applies_to = $${params.length}`;
  }
  if (visibleOnly) {
    params.push(true);
    where += ` AND visible = $${params.length}`;
  }

  const rs = await pool.query(
    `SELECT id, field_key, label, data_type, required, visible, position, applies_to, preset_scope, config_json, updated_at
      FROM invoice_custom_fields
      WHERE ${where}
      ORDER BY applies_to ASC, position ASC, id ASC`,
    params
  );

  return NextResponse.json({ items: rs.rows || [] });
}

export async function POST(req: Request) {
  const access = await requireAnyPermission(
    req,
    ["perm.invoice.custom_fields.manage", "perm.settings.manage"],
    "Forbidden"
  );
  if ("response" in access) return access.response;

  const body = (await req.json().catch(() => ({}))) as CustomFieldBody;
  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const fieldKey = normalizeFieldKey(String(body.field_key || ""));
  const label = String(body.label || "").trim().slice(0, 120);
  const dataType = normalizeCustomFieldDataType(body.data_type);
  const required = body.required === true;
  const visible = body.visible !== false;
  const position = normalizePosition(body.position, 100);
  const appliesTo = normalizeCustomFieldAppliesTo(body.applies_to);
  const configJson = normalizeCustomFieldConfig(dataType, body.config_json || {});

  if (!fieldKey || !label) {
    return NextResponse.json({ error: "field_key and label are required" }, { status: 400 });
  }

  const rs = await pool.query(
    `INSERT INTO invoice_custom_fields
      (business_id, field_key, label, data_type, required, visible, position, applies_to, config_json)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (business_id, field_key)
     DO UPDATE SET
      label = EXCLUDED.label,
      data_type = EXCLUDED.data_type,
      required = EXCLUDED.required,
      visible = EXCLUDED.visible,
      position = EXCLUDED.position,
      applies_to = EXCLUDED.applies_to,
      config_json = EXCLUDED.config_json,
      updated_at = NOW()
     RETURNING id, field_key, label, data_type, required, visible, position, applies_to, preset_scope, config_json, updated_at`,
    [
      businessId,
      fieldKey,
      label,
      dataType,
      required,
      visible,
      position,
      appliesTo,
      JSON.stringify(configJson),
    ]
  );

  return NextResponse.json({ ok: true, item: rs.rows?.[0] || null }, { status: 201 });
}

export async function PUT(req: Request) {
  const access = await requireAnyPermission(
    req,
    ["perm.invoice.custom_fields.manage", "perm.settings.manage"],
    "Forbidden"
  );
  if ("response" in access) return access.response;

  const body = (await req.json().catch(() => ({}))) as CustomFieldBody;
  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const id = Number(body.id || 0);

  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const label = String(body.label || "").trim().slice(0, 120);
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  const dataType = normalizeCustomFieldDataType(body.data_type);
  const required = body.required === true;
  const visible = body.visible !== false;
  const position = normalizePosition(body.position, 100);
  const appliesTo = normalizeCustomFieldAppliesTo(body.applies_to);
  const configJson = normalizeCustomFieldConfig(dataType, body.config_json || {});

  const rs = await pool.query(
    `UPDATE invoice_custom_fields
        SET label = $3,
            data_type = $4,
            required = $5,
            visible = $6,
            position = $7,
            applies_to = $8,
            config_json = $9::jsonb,
            updated_at = NOW()
      WHERE business_id = $1
        AND id = $2
      RETURNING id, field_key, label, data_type, required, visible, position, applies_to, preset_scope, config_json, updated_at`,
    [
      businessId,
      id,
      label,
      dataType,
      required,
      visible,
      position,
      appliesTo,
      JSON.stringify(configJson),
    ]
  );

  if (rs.rowCount === 0) {
    return NextResponse.json({ error: "Custom field not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, item: rs.rows?.[0] || null });
}

export async function DELETE(req: Request) {
  const access = await requireAnyPermission(
    req,
    ["perm.invoice.custom_fields.manage", "perm.settings.manage"],
    "Forbidden"
  );
  if ("response" in access) return access.response;

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id") || 0);

  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const rs = await pool.query(
    `DELETE FROM invoice_custom_fields
      WHERE business_id = $1
        AND id = $2
      RETURNING id`,
    [businessId, id]
  );

  if (rs.rowCount === 0) {
    return NextResponse.json({ error: "Custom field not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id });
}
