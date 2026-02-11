// app/api/quotations/export/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/app/lib/db";
import { getRequestBusinessId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const access = await requireAnyPermission(
    req,
    ["perm.quotations.manage", "perm.sales.manage", "perm.export.manage", "perm.reports.view"],
    "Forbidden"
  );
  if ("response" in access) return access.response;

  const url = new URL(req.url);
  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const q = url.searchParams.get("q")?.trim() || "";
  const from = url.searchParams.get("from")?.trim() || "";
  const to = url.searchParams.get("to")?.trim() || "";
  const idsP = url.searchParams.get("ids")?.trim() || "";

  const db = await getDb();
  const scopedTables = await getBusinessScopedTables(db, ["quotations", "customers"]);
  const hasQuotationBusiness = scopedTables.has("quotations");
  const hasCustomerBusiness = scopedTables.has("customers");

  const where: string[] = [];
  const params: any[] = hasQuotationBusiness || hasCustomerBusiness ? [businessId] : [];
  const businessRef = params.length ? `$1` : null;
  if (hasQuotationBusiness && businessRef) {
    where.push(`q.business_id = ${businessRef}`);
  }
  if (!hasQuotationBusiness && hasCustomerBusiness) {
    where.push(`c.id IS NOT NULL`);
  }
  let p = params.length + 1;

  if (idsP) {
    const ids = idsP
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n));
    if (!ids.length) {
      return NextResponse.json({ error: "No valid ids provided" }, { status: 400 });
    }
    where.push(`q.id = ANY($${p}::int[])`);
    params.push(ids);
    p++;
  } else {
    if (q) {
      where.push(`(c.name ILIKE $${p} OR q.quotation_number ILIKE $${p})`);
      params.push(`%${q}%`);
      p++;
    }
    if (from) {
      where.push(`q.quotation_date::date >= $${p}::date`);
      params.push(from);
      p++;
    }
    if (to) {
      where.push(`q.quotation_date::date < ($${p}::date + INTERVAL '1 day')`);
      params.push(to);
      p++;
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const customerJoin = `LEFT JOIN customers c ON c.id = q.customer_id${
    hasCustomerBusiness && businessRef ? ` AND c.business_id = ${businessRef}` : ""
  }`;
  const { rows } = await db.query(
    `
    SELECT
      q.id,
      q.quotation_number,
      q.quotation_date,
      q.valid_until,
      c.name AS customer_name,
      COALESCE(
        SUM(
          (qi.qty * qi.price)
          - CASE WHEN qi.discount > 0
                 THEN CASE WHEN qi.discount <= 100
                           THEN (qi.qty*qi.price) * (qi.discount/100.0)
                           ELSE qi.discount END
                 ELSE 0 END
          + (
              ( (qi.qty*qi.price)
                - CASE WHEN qi.discount > 0
                       THEN CASE WHEN qi.discount <= 100
                                 THEN (qi.qty*qi.price) * (qi.discount/100.0)
                                 ELSE qi.discount END
                       ELSE 0 END
              ) * (COALESCE(qi.tax,0)/100.0)
            )
        ),
        0
      )::float8 AS total_amount
    FROM quotations q
    ${customerJoin}
    LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
    ${whereSql}
    GROUP BY q.id, q.quotation_number, q.quotation_date, q.valid_until, c.name
    ORDER BY q.quotation_date DESC, q.id DESC
    `,
    params
  );

  const lines: string[] = [];
  lines.push([
    "id",
    "quotation_number",
    "quotation_date",
    "valid_until",
    "customer_name",
    "total_amount",
  ].join(","));

  for (const r of rows) {
    lines.push([
      csvEscape(r.id),
      csvEscape(r.quotation_number ?? r.id),
      csvEscape(r.quotation_date ? new Date(r.quotation_date).toISOString() : ""),
      csvEscape(r.valid_until ? new Date(r.valid_until).toISOString() : ""),
      csvEscape(r.customer_name ?? ""),
      csvEscape(r.total_amount ?? ""),
    ].join(","));
  }

  const csv = "\uFEFF" + lines.join("\n");
  const name =
    from && to ? `quotations_${from}_${to}.csv`
    : idsP ? "quotations_selected.csv"
    : "quotations_export.csv";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
