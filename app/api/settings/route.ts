// app/api/settings/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { requireAnyPermission } from "@/app/lib/request-access";

export const dynamic = "force-dynamic";

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

async function getSettingsColumns(client: any): Promise<Set<string>> {
  const rs = await client.query(
    `SELECT LOWER(column_name) AS col
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='settings'`
  );
  return new Set<string>((rs.rows || []).map((r: any) => String(r.col)));
}

async function readSetting(client: any, key: string, businessId: number, hasBusiness: boolean) {
  let rs = await client.query(
    `SELECT value_json
       FROM settings
      WHERE key = $1${hasBusiness ? " AND business_id = $2" : ""}
      ORDER BY id DESC
      LIMIT 1`,
    hasBusiness ? [key, businessId] : [key]
  );

  if (!rs.rowCount && hasBusiness) {
    rs = await client.query(
      `SELECT value_json
         FROM settings
        WHERE key = $1
        ORDER BY id DESC
        LIMIT 1`,
      [key]
    );
  }

  return rs.rows?.[0]?.value_json ?? {};
}

async function writeSetting(
  client: any,
  key: string,
  valueJson: Record<string, unknown>,
  businessId: number,
  hasBusiness: boolean
) {
  if (hasBusiness) {
    const scoped = await client.query(
      `UPDATE settings
          SET value_json = $1::jsonb
        WHERE key = $2 AND business_id = $3`,
      [valueJson, key, businessId]
    );
    if (scoped.rowCount) return;

    const fallback = await client.query(
      `UPDATE settings
          SET value_json = $1::jsonb
        WHERE key = $2`,
      [valueJson, key]
    );
    if (fallback.rowCount) return;

    await client.query(
      `INSERT INTO settings(key, business_id, value_json)
       VALUES($1, $2, $3::jsonb)`,
      [key, businessId, valueJson]
    );
    return;
  }

  await client.query(
    `INSERT INTO settings(key, value_json)
     VALUES($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
    [key, valueJson]
  );
}

async function syncLegacyBusinessValue(
  client: any,
  valueJson: Record<string, unknown>,
  businessId: number,
  hasBusiness: boolean
) {
  const col = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='settings' AND column_name='value'
     ) AS has_value`
  );
  const hasValue = !!col.rows?.[0]?.has_value;
  if (!hasValue) return;

  await client.query(
    `UPDATE settings
        SET value = $1
      WHERE key='business'${hasBusiness ? " AND business_id = $2" : ""}`,
    hasBusiness ? [JSON.stringify(valueJson), businessId] : [JSON.stringify(valueJson)]
  );
}

export async function GET(req: Request) {
  const access = await requireAnyPermission(req, ["perm.settings.manage"], "Forbidden");
  if ("response" in access) return access.response;
  const businessId = access.ctx.businessId;

  const url = new URL(req.url);
  const key = (url.searchParams.get("key") || "business").trim();
  const settingsCols = await getSettingsColumns(pool).catch(() => new Set<string>());
  const hasBusiness = settingsCols.has("business_id");

  const obj = await readSetting(pool, key, businessId, hasBusiness);
  return NextResponse.json(obj);
}

export async function PATCH(req: Request) {
  const access = await requireAnyPermission(req, ["perm.settings.manage"], "Forbidden");
  if ("response" in access) return access.response;
  const businessId = access.ctx.businessId;

  try {
    const body = await req.json().catch(() => ({} as any));
    const key = (body?.key || "").trim();
    const value_json = isPlainObject(body?.value_json) ? body.value_json : {};
    if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });

    const settingsCols = await getSettingsColumns(pool).catch(() => new Set<string>());
    const hasBusiness = settingsCols.has("business_id");

    await writeSetting(pool, key, value_json, businessId, hasBusiness);

    if (key === "business") {
      await syncLegacyBusinessValue(pool, value_json, businessId, hasBusiness);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/settings failed:", err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const access = await requireAnyPermission(req, ["perm.settings.manage"], "Forbidden");
  if ("response" in access) return access.response;
  const businessId = access.ctx.businessId;

  try {
    const body = await req.json();
    const data = isPlainObject(body) ? body : {};

    const settingsCols = await getSettingsColumns(pool).catch(() => new Set<string>());
    const hasBusiness = settingsCols.has("business_id");

    await writeSetting(pool, "business", data, businessId, hasBusiness);
    await syncLegacyBusinessValue(pool, data, businessId, hasBusiness);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/settings failed:", err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
