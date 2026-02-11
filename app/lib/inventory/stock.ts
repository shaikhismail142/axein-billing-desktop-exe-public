// app/lib/inventory/stock.ts
import { pool } from "@/app/lib/db";

type Queryable = {
  query: (text: string, params?: any[]) => Promise<any>;
};

const tableColumnsCache = new Map<string, Set<string>>();

async function getTableColumns(exec: Queryable, table: string): Promise<Set<string>> {
  const cached = tableColumnsCache.get(table);
  if (cached) return cached;

  const rs = await exec.query(
    `SELECT lower(column_name) AS col
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  const cols = new Set<string>((rs.rows || []).map((r: any) => String(r.col)));
  tableColumnsCache.set(table, cols);
  return cols;
}

/**
 * Reads current inventory settings.
 * If missing, falls back to sane defaults.
 */
export async function getInventorySettings(client?: any, businessId = 1): Promise<{
  allow_negative_stock: boolean;
  low_stock_threshold_default: number;
  reorder_multiplier: number;
  alert_channels: string[];
}> {
  const exec = client ?? pool;

  let hasSettingsBusiness = false;
  try {
    const settingsCols = await getTableColumns(exec, "settings");
    hasSettingsBusiness = settingsCols.has("business_id");
  } catch {
    hasSettingsBusiness = false;
  }

  const normalizedBusinessId =
    Number.isFinite(Number(businessId)) && Number(businessId) > 0 ? Number(businessId) : 1;
  const rs = await exec.query(
    `SELECT value_json
       FROM settings
      WHERE key = 'inventory'${hasSettingsBusiness ? " AND business_id = $1" : ""}
      ORDER BY id DESC
      LIMIT 1`,
    hasSettingsBusiness ? [normalizedBusinessId] : []
  );
  const j = rs.rows?.[0]?.value_json ?? {};
  return {
    allow_negative_stock: !!j.allow_negative_stock,
    low_stock_threshold_default: Number(j.low_stock_threshold_default ?? 5),
    reorder_multiplier: Number(j.reorder_multiplier ?? 1.5),
    alert_channels: Array.isArray(j.alert_channels) ? j.alert_channels : ["dashboard"],
  };
}

/**
 * Lock product row and read meta.stock_qty.
 */
async function lockAndReadProductById(client: any, id: number, businessId: number) {
  const productCols = await getTableColumns(client, "products");
  const hasProductsBusiness = productCols.has("business_id");
  const rs = await client.query(
    `SELECT id, name, meta
       FROM products
      WHERE id = $1${hasProductsBusiness ? " AND business_id = $2" : ""}
      FOR UPDATE`,
    hasProductsBusiness ? [id, businessId] : [id]
  );
  if (rs.rowCount === 0) return null;
  const row = rs.rows[0] as { id: number; name: string; meta: any };
  const meta = row.meta || {};
  const current = Number(meta.stock_qty ?? meta.stock ?? 0) || 0;
  return { id: row.id, name: row.name, meta, current, hasProductsBusiness };
}

/**
 * Adjust stock atomically and record a stock_movements entry.
 * - Positive delta: stock in
 * - Negative delta: stock out
 */
export async function adjustStock(opts: {
  client?: any;
  productId: number;
  businessId?: number;
  delta: number;
  reason:
    | "sale" | "return" | "purchase" | "adjustment"
    | "damage" | "loss" | "promo" | "correction";
  refType?: string;
  refId?: number | string | null;
  allowNegativeOverride?: boolean;
  meta?: Record<string, any>;
}) {
  const {
    client: extClient,
    productId,
    businessId,
    delta,
    reason,
    refType,
    refId,
    allowNegativeOverride,
    meta = {},
  } = opts;

  const client = extClient ?? (await pool.connect());
  const createdTx = !extClient;
  const effectiveBusinessId = Number.isFinite(Number(businessId)) && Number(businessId) > 0
    ? Number(businessId)
    : 1;

  try {
    if (createdTx) await client.query("BEGIN");

    const settings = await getInventorySettings(client, effectiveBusinessId);
    const allowNegative = allowNegativeOverride ?? settings.allow_negative_stock;

    const locked = await lockAndReadProductById(client, Number(productId), effectiveBusinessId);
    if (!locked) throw new Error("Product not found");

    const before = Number(locked.current);
    let after = before + Number(delta);
    if (!allowNegative) after = Math.max(0, after);
    const nextMeta = { ...locked.meta, stock_qty: after };

    await client.query(
      `UPDATE products
          SET meta = $2::jsonb
        WHERE id = $1${locked.hasProductsBusiness ? " AND business_id = $3" : ""}`,
      locked.hasProductsBusiness
        ? [locked.id, JSON.stringify(nextMeta), effectiveBusinessId]
        : [locked.id, JSON.stringify(nextMeta)]
    );

    const movementCols = await getTableColumns(client, "stock_movements");
    const hasMovementBusiness = movementCols.has("business_id");
    const movementColumns = [
      ...(hasMovementBusiness ? ["business_id"] : []),
      "product_id",
      "delta_qty",
      "reason",
      "ref_type",
      "ref_id",
      "before_qty",
      "after_qty",
      "meta",
    ];
    const movementValues = [
      ...(hasMovementBusiness ? [effectiveBusinessId] : []),
      locked.id,
      Number(delta),
      String(reason),
      refType ?? null,
      refId ?? null,
      before,
      after,
      JSON.stringify(meta),
    ];
    const movementPlaceholders = movementValues.map((_, idx) => `$${idx + 1}`).join(", ");

    await client.query(
      `INSERT INTO stock_movements (${movementColumns.join(", ")})
       VALUES (${movementPlaceholders})`,
      movementValues
    );

    if (createdTx) await client.query("COMMIT");
    return { ok: true, product_id: locked.id, before, after };
  } catch (e: any) {
    if (createdTx) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    return { ok: false, error: e?.message || "adjustStock failed" };
  } finally {
    if (!extClient) client.release();
  }
}
