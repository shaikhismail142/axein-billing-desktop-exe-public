// app/api/inventory/settings/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";
import { requireAnyPermission } from "@/app/lib/request-access";

async function getTableColumns(client: any, table: string): Promise<Set<string>> {
  const rs = await client.query(
    `SELECT lower(column_name) AS col
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return new Set<string>((rs.rows || []).map((r: any) => String(r.col)));
}

export async function GET(req: Request) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const access = await requireAnyPermission(req, ["perm.inventory.manage", "perm.settings.manage"], "Forbidden");
  if (!access.ok) return access.response;
  const businessId = access.ctx.businessId;

  const settingsCols = await getTableColumns(pool, "settings").catch(() => new Set<string>());
  const hasSettingsBusiness = settingsCols.has("business_id");

  let rs = await pool.query(
    `SELECT value_json
       FROM settings
      WHERE key='inventory'${hasSettingsBusiness ? " AND business_id = $1" : ""}
      ORDER BY id DESC
      LIMIT 1`,
    hasSettingsBusiness ? [businessId] : []
  );

  if (!rs.rowCount && hasSettingsBusiness) {
    rs = await pool.query(
      `SELECT value_json FROM settings WHERE key='inventory' ORDER BY id DESC LIMIT 1`
    );
  }

  return NextResponse.json(rs.rows?.[0]?.value_json ?? {});
}

export async function PATCH(req: Request) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const access = await requireAnyPermission(req, ["perm.inventory.manage", "perm.settings.manage"], "Forbidden");
  if (!access.ok) return access.response;
  const businessId = access.ctx.businessId;

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {}

  const merged = {
    allow_negative_stock: !!payload.allow_negative_stock,
    low_stock_threshold_default: Number(payload.low_stock_threshold_default ?? 5),
    reorder_multiplier: Number(payload.reorder_multiplier ?? 1.5),
    alert_channels: Array.isArray(payload.alert_channels) ? payload.alert_channels : ["dashboard"],
  };

  const settingsCols = await getTableColumns(pool, "settings").catch(() => new Set<string>());
  const hasSettingsBusiness = settingsCols.has("business_id");

  if (hasSettingsBusiness) {
    const scopedUpdate = await pool.query(
      `UPDATE settings
          SET value_json = $1::jsonb
        WHERE key = 'inventory' AND business_id = $2`,
      [JSON.stringify(merged), businessId]
    );

    if (!scopedUpdate.rowCount) {
      const fallbackUpdate = await pool.query(
        `UPDATE settings SET value_json = $1::jsonb WHERE key = 'inventory'`,
        [JSON.stringify(merged)]
      );

      if (!fallbackUpdate.rowCount) {
        await pool.query(
          `INSERT INTO settings(key, business_id, value_json)
             VALUES ('inventory', $1, $2::jsonb)`,
          [businessId, JSON.stringify(merged)]
        );
      }
    }
  } else {
    await pool.query(
      `INSERT INTO settings(key, value_json)
         VALUES ('inventory', $1::jsonb)
       ON CONFLICT (key) DO UPDATE
         SET value_json = $1::jsonb`,
      [JSON.stringify(merged)]
    );
  }

  return NextResponse.json({ ok: true, settings: merged });
}
