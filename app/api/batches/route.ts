// app/api/batches/route.ts

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";
import { requireAnyPermission } from "@/app/lib/request-access";

type ColMap = {
  table: string;
  id: string;
  product_id: string;
  batch_no?: string;
  mfg_date?: string;
  exp_date?: string;
  qty?: string;
  cost_price?: string;
  mrp?: string;
  supplier_id?: string;
  business_id?: string;
};

async function getTableColumns(client: any, table: string): Promise<Set<string>> {
  const r = await client.query(
    `SELECT LOWER(column_name) AS col
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return new Set<string>((r.rows || []).map((x: any) => String(x.col)));
}

async function detectBatchesTableAndColumns(client: any): Promise<ColMap> {
  const tRes = await client.query(`
    SELECT COALESCE(
      (SELECT 'product_batches' WHERE to_regclass('public.product_batches') IS NOT NULL),
      (SELECT 'batches'          WHERE to_regclass('public.batches') IS NOT NULL),
      ''
    ) AS t
  `);
  const table = (tRes.rows?.[0] as any)?.t || "";
  if (!table) throw new Error("No batches table found (expected product_batches or batches).");

  const cols = await getTableColumns(client, table);
  const pick = (...candidates: string[]) => candidates.find((c) => cols.has(c));

  const id = pick("id") || "id";
  const product_id = pick("product_id") || "product_id";
  const batch_no = pick("batch_no", "batch", "batch_code", "batchcode");
  const mfg_date = pick("mfg_date", "manufacture_date", "manufacturing_date", "mfd_date", "mfg_on");
  const exp_date = pick("exp_date", "expiry_date", "expiration_date", "exp_dt", "expiry_on", "expire_on");
  const qty = pick("qty", "quantity", "available_qty", "stock_qty");
  const cost_price = pick("cost_price", "cost", "purchase_price", "base_cost");
  const mrp = pick("mrp", "retail_price", "sell_price", "selling_price", "price");
  const supplier_id = pick("supplier_id", "vendor_id");
  const business_id = pick("business_id");

  return {
    table,
    id,
    product_id,
    batch_no,
    mfg_date,
    exp_date,
    qty,
    cost_price,
    mrp,
    supplier_id,
    business_id,
  };
}

export async function GET(req: NextRequest) {
  if (process.env.BUILDING === "1") {
    return Response.json({
      ok: true,
      page: 1,
      pageSize: 20,
      total: 0,
      items: [],
      prefs: { near_expiry_days: 60 },
      table: "product_batches",
      note: "build-skip",
    });
  }

  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const access = await requireAnyPermission(
    req,
    ["perm.inventory.manage", "perm.purchases.manage", "perm.sales.manage"],
    "Forbidden"
  );
  if ("response" in access) return access.response;
  const businessId = access.ctx.businessId;

  const client = await pool.connect();
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
    const offset = (page - 1) * pageSize;

    const q = (searchParams.get("q") || "").trim();
    const productId = (searchParams.get("productId") || "").trim();
    const onlyQty = (searchParams.get("onlyQty") || "true") === "true";
    const expiry = (searchParams.get("expiry") || "all").toLowerCase();

    const settingsCols = await getTableColumns(client, "settings").catch(() => new Set<string>());
    const hasSettingsBusiness = settingsCols.has("business_id");
    let prefRes = await client.query(
      `WITH s AS (
         SELECT (value_json->>'near_expiry_days')::int AS near_expiry_days
           FROM settings
          WHERE key = 'inventory_prefs'${hasSettingsBusiness ? " AND business_id = $1" : ""}
          ORDER BY id DESC
          LIMIT 1
       )
       SELECT COALESCE((SELECT near_expiry_days FROM s), 60) AS near_expiry_days`,
      hasSettingsBusiness ? [businessId] : []
    );
    if (!prefRes.rowCount && hasSettingsBusiness) {
      prefRes = await client.query(
        `WITH s AS (
           SELECT (value_json->>'near_expiry_days')::int AS near_expiry_days
             FROM settings
            WHERE key = 'inventory_prefs'
            ORDER BY id DESC
            LIMIT 1
         )
         SELECT COALESCE((SELECT near_expiry_days FROM s), 60) AS near_expiry_days`
      );
    }
    const nearDays = Number((prefRes.rows?.[0] as any)?.near_expiry_days ?? 60);

    const map = await detectBatchesTableAndColumns(client);
    const t = map.table;

    const productCols = await getTableColumns(client, "products").catch(() => new Set<string>());
    const hasProductsBusiness = productCols.has("business_id");
    const hasBatchBusiness = !!map.business_id;

    const where: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (hasBatchBusiness) {
      where.push(`b.${map.business_id} = $${i++}`);
      params.push(businessId);
    }
    if (hasProductsBusiness) {
      where.push(`p.business_id = $${i++}`);
      params.push(businessId);
    }

    if (q) {
      const nameLike = `(LOWER(p.name) LIKE LOWER($${i}))`;
      const batchLike = map.batch_no ? ` OR LOWER(b.${map.batch_no}) LIKE LOWER($${i})` : "";
      where.push(`(${nameLike}${batchLike})`);
      params.push(`%${q}%`);
      i++;
    }
    if (productId) {
      where.push(`b.${map.product_id} = $${i}`);
      params.push(productId);
      i++;
    }
    if (onlyQty && map.qty) {
      where.push(`b.${map.qty} > 0`);
    }
    if (expiry === "near" && map.exp_date) {
      where.push(
        `b.${map.exp_date} IS NOT NULL AND b.${map.exp_date} >= CURRENT_DATE AND b.${map.exp_date} <= CURRENT_DATE + INTERVAL '${nearDays} days'`
      );
    } else if (expiry === "expired" && map.exp_date) {
      where.push(`b.${map.exp_date} IS NOT NULL AND b.${map.exp_date} < CURRENT_DATE`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const joinProducts = `JOIN products p ON p.id = b.${map.product_id}${
      hasProductsBusiness && hasBatchBusiness ? ` AND p.business_id = b.${map.business_id}` : ""
    }`;

    const countRes = await client.query(
      `SELECT COUNT(*)::text AS count
       FROM ${t} b
       ${joinProducts}
       ${whereSql}`,
      params
    );
    const total = parseInt(((countRes.rows?.[0] as any)?.count || "0") as string, 10);

    const sel = [
      `b.${map.id} AS id`,
      `b.${map.product_id} AS product_id`,
      `p.name AS product_name`,
      `(p.meta->>'sku') AS sku`,
      map.batch_no ? `b.${map.batch_no} AS batch_no` : `'—'::text AS batch_no`,
      map.mfg_date ? `to_char(b.${map.mfg_date}, 'YYYY-MM-DD') AS mfg_date` : `NULL::text AS mfg_date`,
      map.exp_date ? `to_char(b.${map.exp_date}, 'YYYY-MM-DD') AS exp_date` : `NULL::text AS exp_date`,
      map.qty ? `b.${map.qty}::text AS qty` : `'0'::text AS qty`,
      map.cost_price ? `b.${map.cost_price}::text AS cost_price` : `NULL::text AS cost_price`,
      map.mrp ? `b.${map.mrp}::text AS mrp` : `NULL::text AS mrp`,
      map.supplier_id ? `b.${map.supplier_id}::text AS supplier_id` : `NULL::text AS supplier_id`,
      map.exp_date ? `(b.${map.exp_date} - CURRENT_DATE) AS days_left` : `NULL::int AS days_left`,
    ].join(",\n        ");

    const order = map.exp_date
      ? `CASE WHEN b.${map.exp_date} IS NULL THEN 1 ELSE 0 END, b.${map.exp_date} NULLS LAST`
      : `b.${map.id} DESC`;

    const dataRes = await client.query(
      `
      SELECT
        ${sel}
      FROM ${t} b
      ${joinProducts}
      ${whereSql}
      ORDER BY ${order}
      LIMIT ${pageSize} OFFSET ${offset}
      `,
      params
    );

    return Response.json({
      ok: true,
      page,
      pageSize,
      total,
      items: dataRes.rows,
      prefs: { near_expiry_days: nearDays },
      table: t,
      column_map: map,
    });
  } catch (err: any) {
    console.error("GET /api/batches error:", err);
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  } finally {
    client.release();
  }
}
