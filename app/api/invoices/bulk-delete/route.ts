// app/api/invoices/bulk-delete/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { getRequestBusinessId } from "@/app/lib/platform-context";

async function getBusinessScopedTables(client: any, tables: string[]) {
  try {
    const rs = await client.query(
      `SELECT table_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'business_id'
          AND table_name = ANY($1::text[])`,
      [tables]
    );
    return new Set((rs.rows || []).map((r: any) => String(r.table_name || "").toLowerCase()));
  } catch {
    return new Set<string>();
  }
}

export async function POST(req: Request) {
  const businessId = getRequestBusinessId(req, 1);
  const body = await req.json().catch(() => null);
  if (!body) return new NextResponse("Bad JSON", { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scopedTables = await getBusinessScopedTables(client, [
      "sales",
      "customers",
      "sale_items",
      "sale_payments",
    ]);
    const hasSalesBusiness = scopedTables.has("sales");
    const hasCustomerBusiness = scopedTables.has("customers");
    const hasSaleItemBusiness = scopedTables.has("sale_items");
    const hasSalePaymentBusiness = scopedTables.has("sale_payments");
    const businessRef = hasSalesBusiness || hasCustomerBusiness ? "$1" : null;

    // Build a normalized subquery of matching sale IDs (same rules as list/export)
    const where: string[] = [];
    const params: unknown[] = businessRef ? [businessId] : [];

    if (body.all) {
      const q = (body.q || "").trim();
      const from = body.from || "";
      const to = body.to || "";

      const cteScopedWhere: string[] = [];
      if (hasSalesBusiness && businessRef) {
        cteScopedWhere.push(`s.business_id = ${businessRef}`);
      }
      if (!hasSalesBusiness && hasCustomerBusiness) {
        cteScopedWhere.push(`c.id IS NOT NULL`);
      }
      const cteScopedWhereSql = cteScopedWhere.length ? `WHERE ${cteScopedWhere.join(" AND ")}` : "";

      const cte = `
        WITH norm AS (
          SELECT
            s.id,
            COALESCE(
              to_jsonb(s)->>'invoice_no',
              to_jsonb(s)->>'bill_no',
              to_jsonb(s)->>'sale_no',
              to_jsonb(s)->>'number'
            ) AS invno,
            COALESCE(
              (to_jsonb(s)->>'created_at')::timestamp,
              (to_jsonb(s)->>'created_on')::timestamp,
              (to_jsonb(s)->>'date')::timestamp
            ) AS dt,
            COALESCE(c.name, to_jsonb(s)->>'customer_name', '') AS cust
          FROM sales s
          LEFT JOIN customers c
            ON c.id = COALESCE((to_jsonb(s)->>'customer_id')::int, NULL)${
              hasCustomerBusiness && businessRef ? ` AND c.business_id = ${businessRef}` : ""
            }
          ${cteScopedWhereSql}
        )
      `;

      if (q) { params.push(`%${q}%`); const i = params.length; where.push(`(invno ILIKE $${i} OR cust ILIKE $${i})`); }
      if (from) { params.push(from); where.push(`dt >= $${params.length}::date`); }
      if (to)   { params.push(to);   where.push(`dt < ($${params.length}::date + INTERVAL '1 day')`); }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const { rows } = await client.query(
        `${cte} SELECT id FROM norm ${whereSql}`,
        params
      );
      body.ids = rows.map((r: any) => r.id);
    }

    const ids: number[] =
      Array.isArray(body.ids) ? body.ids.filter((n: any) => Number.isFinite(Number(n))).map(Number) : [];

    if (!ids.length) {
      await client.query("ROLLBACK");
      return new NextResponse("No ids to delete", { status: 400 });
    }

    let targetIds = ids;
    if (!hasSalesBusiness && hasCustomerBusiness) {
      const scopedIds = await client.query(
        `SELECT s.id
           FROM sales s
           LEFT JOIN customers c
             ON c.id = COALESCE((to_jsonb(s)->>'customer_id')::int, NULL)
            AND c.business_id = $2
          WHERE s.id = ANY($1::int[])
            AND c.id IS NOT NULL`,
        [ids, businessId]
      );
      targetIds = (scopedIds.rows || []).map((r: any) => Number(r.id)).filter((v: number) => Number.isFinite(v));
    }

    if (!targetIds.length) {
      await client.query("ROLLBACK");
      return new NextResponse("No ids to delete", { status: 400 });
    }

    // If you have sale_items referencing sales(id), remove children first (safe no-op if FK ON DELETE CASCADE)
    if (hasSaleItemBusiness) {
      await client.query(
        `DELETE FROM sale_items WHERE sale_id = ANY($1::int[]) AND business_id = $2`,
        [targetIds, businessId]
      );
    } else {
      await client.query(`DELETE FROM sale_items WHERE sale_id = ANY($1::int[])`, [targetIds]);
    }

    if (hasSalePaymentBusiness) {
      await client
        .query(`DELETE FROM sale_payments WHERE sale_id = ANY($1::int[]) AND business_id = $2`, [targetIds, businessId])
        .catch(() => { /* optional table */ });
    } else {
      await client
        .query(`DELETE FROM sale_payments WHERE sale_id = ANY($1::int[])`, [targetIds])
        .catch(() => { /* optional table */ });
    }

    const del = hasSalesBusiness
      ? await client.query(`DELETE FROM sales WHERE id = ANY($1::int[]) AND business_id = $2`, [targetIds, businessId])
      : await client.query(`DELETE FROM sales WHERE id = ANY($1::int[])`, [targetIds]);
    await client.query("COMMIT");

    return NextResponse.json({ deleted: del.rowCount ?? 0 });
  } catch (e: any) {
    await client.query("ROLLBACK");
    return new NextResponse(e?.message || "Delete failed", { status: 500 });
  } finally {
    client.release();
  }
}
