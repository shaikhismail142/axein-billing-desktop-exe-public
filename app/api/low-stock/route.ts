import { NextResponse } from "next/server";
import { pool } from "../../lib/db";
import { getRequestBusinessId } from "@/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

export const dynamic = "force-dynamic";

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

export async function GET(req: Request) {
  try {
    const access = await requireAnyPermission(
      req,
      ["perm.inventory.manage", "perm.products.manage", "perm.reports.view", "perm.sales.manage", "perm.purchases.manage"],
      "Forbidden"
    );
    if ("response" in access) return access.response;

    const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
    const scoped = await hasProductBusinessColumn();
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.sku, COALESCE(c.name,'other') as category, p.stock, p.reorder_level
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${scoped ? "p.business_id = $1 AND" : ""} p.stock <= COALESCE(p.reorder_level,10)
       ORDER BY p.stock ASC, p.name ASC LIMIT 200`
      ,
      scoped ? [businessId] : []
    );
    return NextResponse.json({ items: rows });
  } catch (err) {
    console.error("GET /api/low-stock failed:", err);
    return NextResponse.json({ error: "Failed to fetch low stock" }, { status: 500 });
  }
}
