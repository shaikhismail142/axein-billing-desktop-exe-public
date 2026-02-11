// app/api/quotations/bulk-delete/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/app/lib/db";
import { getRequestBusinessId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

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
  const access = await requireAnyPermission(
    req,
    ["perm.quotations.manage", "perm.sales.manage"],
    "Forbidden"
  );
  if ("response" in access) return access.response;

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const body = await req.json().catch(() => null);
  if (!body) return new NextResponse("Bad JSON", { status: 400 });

  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const scopedTables = await getBusinessScopedTables(client, ["quotations", "customers", "quotation_items"]);
    const hasQuotationBusiness = scopedTables.has("quotations");
    const hasCustomerBusiness = scopedTables.has("customers");
    const hasQuotationItemBusiness = scopedTables.has("quotation_items");

    const where: string[] = [];
    const params: unknown[] = hasQuotationBusiness || hasCustomerBusiness ? [businessId] : [];
    const businessRef = params.length ? `$1` : null;

    if (body.all) {
      const q = (body.q || "").trim();
      if (hasQuotationBusiness && businessRef) {
        where.push(`q.business_id = ${businessRef}`);
      }
      if (!hasQuotationBusiness && hasCustomerBusiness) {
        where.push(`c.id IS NOT NULL`);
      }

      if (q) {
        params.push(`%${q}%`);
        where.push(`(c.name ILIKE $${params.length} OR q.quotation_number ILIKE $${params.length})`);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const { rows } = await client.query(
        `
        SELECT q.id
        FROM quotations q
        LEFT JOIN customers c ON c.id = q.customer_id${
          hasCustomerBusiness && businessRef ? ` AND c.business_id = ${businessRef}` : ""
        }
        ${whereSql}
        `,
        params
      );
      body.ids = rows.map((r: any) => r.id);
    }

    const ids: number[] =
      Array.isArray(body.ids) ? body.ids.filter((n: any) => Number.isFinite(Number(n))).map(Number) : [];

    if (ids.length === 0) {
      await client.query("ROLLBACK");
      return new NextResponse("No ids to delete", { status: 400 });
    }

    const deleteItemParams: unknown[] = [ids];
    const itemBusinessFilter = hasQuotationItemBusiness ? ` AND business_id = $${deleteItemParams.push(businessId)}` : "";
    await client.query(
      `DELETE FROM quotation_items WHERE quotation_id = ANY($1::int[])${itemBusinessFilter}`,
      deleteItemParams
    );

    const deleteQuotationParams: unknown[] = [ids];
    const quotationBusinessFilter = hasQuotationBusiness
      ? ` AND business_id = $${deleteQuotationParams.push(businessId)}`
      : "";
    const del = await client.query(
      `DELETE FROM quotations WHERE id = ANY($1::int[])${quotationBusinessFilter}`,
      deleteQuotationParams
    );
    await client.query("COMMIT");

    const deleted =
      (del as any)?.rowCount ??
      (Array.isArray((del as any)?.rows) ? (del as any).rows.length : 0);
    return NextResponse.json({ deleted });
  } catch (e: any) {
    await client.query("ROLLBACK");
    return new NextResponse(e?.message || "Delete failed", { status: 500 });
  } finally {
    client.release();
  }
}
