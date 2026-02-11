// app/api/products/low-stock/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId } from "@/lib/platform-context";

async function hasProductBusinessColumn() {
  try {
    const rs = await pool.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='products'
          AND column_name='business_id'
        LIMIT 1`
    );
    return (rs.rowCount || 0) > 0;
  } catch {
    return false;
  }
}

/** GET: list products where stock_qty <= low_stock_threshold (meta) */
export async function GET(req: Request) {
  try {
    const businessId = getRequestBusinessId(req, 1);
    const scoped = await hasProductBusinessColumn();
    const r = await pool.query(`
      SELECT id, name,
        COALESCE((meta->>'stock_qty')::numeric,0) AS stock_qty,
        COALESCE((meta->>'low_stock_threshold')::numeric,0) AS low_stock_threshold
      FROM products
      WHERE ${scoped ? "business_id = $1 AND" : ""}
        COALESCE((meta->>'stock_qty')::numeric,0) <= COALESCE((meta->>'low_stock_threshold')::numeric,0)
      ORDER BY name
      LIMIT 200
    `, scoped ? [businessId] : []);
    return NextResponse.json({ items: r.rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

/** PATCH: set threshold or stock manually
 * body: { product_id, low_stock_threshold?, stock_qty? }
 */
export async function PATCH(req: Request) {
  const businessId = getRequestBusinessId(req, 1);
  let body: { product_id: number; low_stock_threshold?: number; stock_qty?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
  if (!Number.isFinite(body.product_id)) return NextResponse.json({ error: "product_id required" }, { status: 400 });

  try {
    const scoped = await hasProductBusinessColumn();
    const r = await pool.query(
      `SELECT id, meta FROM products WHERE id=$1${scoped ? " AND business_id = $2" : ""}`,
      scoped ? [body.product_id, businessId] : [body.product_id]
    );
    if (!r.rowCount) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const meta = r.rows[0].meta || {};
    if (typeof body.low_stock_threshold === "number") meta.low_stock_threshold = body.low_stock_threshold;
    if (typeof body.stock_qty === "number") meta.stock_qty = body.stock_qty;

    await pool.query(
      `UPDATE products SET meta=$2::jsonb WHERE id=$1${scoped ? " AND business_id = $3" : ""}`,
      scoped ? [body.product_id, JSON.stringify(meta), businessId] : [body.product_id, JSON.stringify(meta)]
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
