// app/api/quotations/[id]/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId } from "@/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

async function getBusinessScopedTables(tables: string[]) {
  try {
    const rs = await pool.query(
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

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAnyPermission(
    req,
    ["perm.quotations.manage", "perm.sales.manage", "perm.reports.view"],
    "Forbidden"
  );
  if ("response" in access) return access.response;

  const id = Number(params.id);
  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const scopedTables = await getBusinessScopedTables(["quotations", "customers", "quotation_items"]);
  const hasQuotationBusiness = scopedTables.has("quotations");
  const hasCustomerBusiness = scopedTables.has("customers");
  const hasQuotationItemBusiness = scopedTables.has("quotation_items");

  const headerParams: unknown[] = [id];
  const quoteBusinessRef = hasQuotationBusiness ? `$${headerParams.push(businessId)}` : null;
  const customerBusinessJoin = hasCustomerBusiness
    ? ` AND c.business_id = ${quoteBusinessRef || `$${headerParams.push(businessId)}`}`
    : "";

  // Customer details are stored as columns in the current schema. Returning
  // the row as JSON preserves the legacy customer_meta response shape without
  // depending on a removed customers.meta column.
  const q = await pool.query(
    `select q.*,
            c.name  as customer_name,
            to_jsonb(c) as customer_meta
       from quotations q
       left join customers c on c.id = q.customer_id${customerBusinessJoin}
      where q.id = $1${quoteBusinessRef ? ` and q.business_id = ${quoteBusinessRef}` : ""}${
      !quoteBusinessRef && hasCustomerBusiness ? " and c.id is not null" : ""
    }
      limit 1`,
    headerParams
  );
  if (q.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const quotation = q.rows[0];

  // Items (description/qty/price/tax/discount)
  const itemParams: unknown[] = [id];
  const itemBusinessFilter = hasQuotationItemBusiness ? ` and business_id = $${itemParams.push(businessId)}` : "";
  const itemsRs = await pool.query(
    `select id, product_id, description, qty, price, tax, discount, total, batch_no, exp_date
       from quotation_items
      where quotation_id = $1${itemBusinessFilter}
      order by id asc`,
    itemParams
  );

  return NextResponse.json({
    quotation,
    items: itemsRs.rows,
  });
}
