import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireRevenueAccess } from "@/app/lib/request-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const access = await requireRevenueAccess(req);
  if (!access.ok) return access.response;
  const businessId = access.ctx.businessId;

  const url = new URL(req.url);
  const days = Math.max(1, Number(url.searchParams.get("days") ?? 30));
  const onlyBelow = (url.searchParams.get("below") ?? "").toLowerCase() === "true";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const perPage = Math.min(200, Math.max(1, Number(url.searchParams.get("perPage") ?? 50)));
  const offset = (page - 1) * perPage;

  const baseSql = `
    WITH recent AS (
      SELECT DISTINCT lower(si.name) AS nm
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.invoice_date >= NOW() - INTERVAL '${days} days'
        AND s.business_id = $1
    )
    SELECT
      p.id,
      p.name,
      COALESCE(NULLIF(p.meta->>'stock_qty','')::int, 0) AS stock_qty,
      COALESCE(NULLIF(p.meta->>'low_stock_threshold','')::int, 0) AS low_stock_threshold
    FROM products p
    LEFT JOIN recent r ON lower(p.name) = r.nm
    WHERE r.nm IS NULL
      AND p.business_id = $1
      ${onlyBelow ? "AND COALESCE(NULLIF(p.meta->>'stock_qty','')::int, 0) <= COALESCE(NULLIF(p.meta->>'low_stock_threshold','')::int, 0)" : ""}
  `;

  const countRes = await pool.query(`SELECT COUNT(*)::int AS cnt FROM (${baseSql}) x`, [businessId]);
  const total = countRes.rows?.[0]?.cnt ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const { rows } = await pool.query(
    `
    ${baseSql}
    ORDER BY p.name ASC
    LIMIT $2 OFFSET $3
    `
    ,
    [businessId, perPage, offset]
  );

  return NextResponse.json({
    items: rows,
    days,
    onlyBelow,
    page,
    perPage,
    total,
    totalPages,
  });
}
