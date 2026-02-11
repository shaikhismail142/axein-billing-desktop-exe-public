export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";
import { requireAnyPermission } from "@/app/lib/request-access";

type BatchMap = {
  table: string;
  productId: string;
  expiryDate?: string;
  businessId?: string;
};

async function getTableColumns(client: any, table: string): Promise<Set<string>> {
  const rs = await client.query(
    `SELECT lower(column_name) AS col
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return new Set<string>((rs.rows || []).map((r: any) => String(r.col)));
}

async function detectBatches(client: any): Promise<BatchMap | null> {
  const rs = await client.query(
    `SELECT COALESCE(
       (SELECT 'product_batches' WHERE to_regclass('public.product_batches') IS NOT NULL),
       (SELECT 'batches' WHERE to_regclass('public.batches') IS NOT NULL),
       ''
     ) AS t`
  );
  const table = String(rs.rows?.[0]?.t || "");
  if (!table) return null;

  const cols = await getTableColumns(client, table);
  const pick = (...names: string[]) => names.find((n) => cols.has(n));

  const productId = pick("product_id") || "product_id";
  const expiryDate = pick("expiry_date", "exp_date", "expiration_date", "expiry_on", "expire_on");
  const businessId = pick("business_id");

  return { table, productId, expiryDate, businessId };
}

export async function GET(req: Request) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const access = await requireAnyPermission(
    req,
    ["perm.inventory.manage", "perm.purchases.manage", "perm.sales.manage"],
    "Forbidden"
  );
  if ("response" in access) return access.response;
  const businessId = access.ctx.businessId;

  const url = new URL(req.url);
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 90)));

  const client = await pool.connect();
  try {
    const batch = await detectBatches(client);
    if (!batch || !batch.expiryDate) {
      return NextResponse.json([]);
    }

    const productCols = await getTableColumns(client, "products").catch(() => new Set<string>());
    const hasProductsBusiness = productCols.has("business_id");
    const hasBatchesBusiness = !!batch.businessId;

    const where = [
      `b.${batch.expiryDate} IS NOT NULL`,
      `b.${batch.expiryDate} <= (CURRENT_DATE + $1::interval)`,
    ];
    const params: any[] = [`${days} days`];

    if (hasBatchesBusiness) {
      params.push(businessId);
      where.push(`b.${batch.businessId} = $${params.length}`);
    }
    if (hasProductsBusiness) {
      params.push(businessId);
      where.push(`p.business_id = $${params.length}`);
    }

    const { rows } = await client.query(
      `SELECT b.*, p.name AS product_name
         FROM ${batch.table} b
         JOIN products p
           ON p.id = b.${batch.productId}${
             hasProductsBusiness && hasBatchesBusiness ? ` AND p.business_id = b.${batch.businessId}` : ""
           }
        WHERE ${where.join(" AND ")}
        ORDER BY b.${batch.expiryDate} ASC`,
      params
    );

    return NextResponse.json(rows);
  } finally {
    client.release();
  }
}
