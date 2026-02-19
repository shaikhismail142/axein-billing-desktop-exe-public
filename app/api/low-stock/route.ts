import { NextResponse } from "next/server";
import { pool } from "../../lib/db";
import { getRequestBusinessId } from "@/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

export const dynamic = "force-dynamic";

async function getProductColumns() {
  try {
    const rs = await pool.query(
      `SELECT LOWER(column_name) AS col
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='products'
          AND column_name IN ('business_id', 'sku', 'stock', 'reorder_level', 'meta', 'category', 'category_id')`
    );
    return new Set<string>((rs.rows || []).map((r: any) => String(r.col || "").toLowerCase()));
  } catch {
    return new Set<string>();
  }
}

async function getCategoryColumns() {
  try {
    const rs = await pool.query(
      `SELECT LOWER(column_name) AS col
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='categories'
          AND column_name IN ('id', 'name')`
    );
    return new Set<string>((rs.rows || []).map((r: any) => String(r.col || "").toLowerCase()));
  } catch {
    return new Set<string>();
  }
}

export async function GET(req: Request) {
  try {
    const access = await requireAnyPermission(
      req,
      ["perm.inventory.manage", "perm.products.manage", "perm.reports.view", "perm.sales.manage", "perm.purchases.manage"],
      "Forbidden"
    );
    if ("response" in access) return access.response;

    const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
    const productCols = await getProductColumns();
    const categoryCols = await getCategoryColumns();
    const scoped = productCols.has("business_id");
    const hasMeta = productCols.has("meta");
    const hasStock = productCols.has("stock");
    const hasReorder = productCols.has("reorder_level");
    const hasSku = productCols.has("sku");
    const hasCategoryCol = productCols.has("category");
    const hasCategoryRel = productCols.has("category_id") && categoryCols.has("id") && categoryCols.has("name");

    const skuExpr = hasSku ? "p.sku" : hasMeta ? "COALESCE(p.meta->>'sku', '')" : "''";
    const stockExpr = hasStock
      ? "COALESCE(p.stock, 0)"
      : hasMeta
      ? "COALESCE(NULLIF(p.meta->>'stock_qty','')::int, NULLIF(p.meta->>'stock','')::int, 0)"
      : "0";
    const reorderExpr = hasReorder
      ? "COALESCE(p.reorder_level, 10)"
      : hasMeta
      ? "COALESCE(NULLIF(p.meta->>'low_stock_threshold','')::int, 10)"
      : "10";
    const categoryExpr = hasCategoryRel
      ? `COALESCE(NULLIF(c.name, ''), ${
          hasCategoryCol ? "NULLIF(p.category, '')" : "NULL"
        }, ${hasMeta ? "NULLIF(p.meta->>'category', '')" : "NULL"}, 'other')`
      : `COALESCE(${hasCategoryCol ? "NULLIF(p.category, '')" : "NULL"}, ${
          hasMeta ? "NULLIF(p.meta->>'category', '')" : "NULL"
        }, 'other')`;

    const joinSql = hasCategoryRel ? "LEFT JOIN categories c ON c.id = p.category_id" : "";
    const { rows } = await pool.query(
      `SELECT
         p.id,
         p.name,
         ${skuExpr} AS sku,
         ${categoryExpr} AS category,
         ${stockExpr} AS stock,
         ${reorderExpr} AS reorder_level
       FROM products p
       ${joinSql}
       WHERE ${scoped ? "p.business_id = $1 AND" : ""} ${stockExpr} <= ${reorderExpr}
       ORDER BY stock ASC, p.name ASC LIMIT 200`
      ,
      scoped ? [businessId] : []
    );
    return NextResponse.json({ items: rows });
  } catch (err) {
    console.error("GET /api/low-stock failed:", err);
    return NextResponse.json({ error: "Failed to fetch low stock" }, { status: 500 });
  }
}
