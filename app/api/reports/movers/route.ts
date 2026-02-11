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
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "from/to required" }, { status: 400 });

  const { rows } = await pool.query(
    `
    SELECT
      si.name,
      SUM(si.qty)::int AS qty,
      COALESCE(SUM(si.qty * si.unit_price * (1 - COALESCE(si.discount_pct,0)/100.0)),0)::numeric(12,2) AS revenue
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.invoice_date >= $1::date
      AND s.invoice_date < ($2::date + INTERVAL '1 day')
      AND s.business_id = $3
    GROUP BY si.name
    ORDER BY qty DESC
    `,
    [from, to, businessId]
  );

  return NextResponse.json({ items: rows });
}
