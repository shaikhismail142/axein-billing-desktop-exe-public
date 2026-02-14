// app/api/quotations/[id]/convert/route.ts
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getRequestBusinessId } from '@/lib/platform-context';
import { requireAnyPermission } from '@/app/lib/request-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function toNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
// Clamp helpers
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function currentFYLabel(d = nowIST()): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const startYear = m <= 3 ? y - 1 : y;
  const a = String(startYear % 100).padStart(2, "0");
  const b = String((startYear + 1) % 100).padStart(2, "0");
  return `FY${a}-${b}`;
}

async function getColumns(client: any, table: string): Promise<Set<string>> {
  const r = await client.query(
    `SELECT LOWER(column_name) AS col
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return new Set<string>(r.rows.map((x: any) => x.col));
}

async function getNextInvoiceNo(
  client: any,
  salesCols: Set<string>,
  businessId: number,
  scopeByBusiness: boolean
): Promise<string> {
  const prefix = `${currentFYLabel()}/`;
  if (!salesCols.has("invoice_no")) {
    // fallback: still generate something user-friendly
    const t = nowIST();
    const ymd = `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCDate()).padStart(2, "0")}`;
    const hm = `${String(t.getUTCHours()).padStart(2, "0")}${String(t.getUTCMinutes()).padStart(2, "0")}`;
    return `INV/${ymd}/${hm}-${Math.floor(Math.random() * 900 + 100)}`;
  }
  const rs = scopeByBusiness
    ? await client.query(
        `SELECT invoice_no
           FROM sales
          WHERE invoice_no LIKE $1
            AND business_id = $2
          ORDER BY id DESC
          LIMIT 1`,
        [prefix + "%", businessId]
      )
    : await client.query(
        `SELECT invoice_no
           FROM sales
          WHERE invoice_no LIKE $1
          ORDER BY id DESC
          LIMIT 1`,
        [prefix + "%"]
      );
  let seq = 1;
  if (rs.rowCount > 0) {
    const last = String(rs.rows[0].invoice_no || "");
    const m = last.match(/(\d+)\s*$/);
    if (m) seq = Number(m[1]) + 1;
  }
  return `${prefix}${String(seq).padStart(5, "0")}`;
}

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
    return new Set((rs.rows || []).map((r: any) => String(r.table_name || '').toLowerCase()));
  } catch {
    return new Set<string>();
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAnyPermission(
    req,
    ['perm.quotations.manage', 'perm.sales.manage'],
    'Forbidden'
  );
  if ('response' in access) return access.response;

  const qid = Number(params.id);
  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  if (!Number.isFinite(qid)) {
    return NextResponse.json({ ok: false, error: 'Invalid quotation id' }, { status: 400 });
  }

  const scopedTables = await getBusinessScopedTables(pool, [
    'sales',
    'sale_items',
    'quotations',
    'quotation_items',
    'customers',
  ]);
  const hasSalesBusiness = scopedTables.has('sales');
  const hasSaleItemsBusiness = scopedTables.has('sale_items');
  const hasQuotationBusiness = scopedTables.has('quotations');
  const hasQuotationItemsBusiness = scopedTables.has('quotation_items');
  const hasCustomerBusiness = scopedTables.has('customers');

  // Idempotency: meta.source_quotation_id
  const existed = (
    hasSalesBusiness
      ? await pool.query(
          `select id
             from sales
            where (meta->>'source_quotation_id')::int = $1
              and business_id = $2
            limit 1`,
          [qid, businessId]
        )
      : await pool.query(
          `select id from sales where (meta->>'source_quotation_id')::int = $1 limit 1`,
          [qid]
        )
  ).rows[0];
  if (existed?.id) {
    return NextResponse.json({
      ok: true,
      sale_id: existed.id,
      redirect: `/invoices/${existed.id}`,
      info: 'Already converted',
    });
  }

  // Load quotation header
  const quoteParams: unknown[] = [qid];
  const quoteBusinessRef = hasQuotationBusiness ? `$${quoteParams.push(businessId)}` : null;
  const customerBusinessJoin = hasCustomerBusiness
    ? ` and c.business_id = ${quoteBusinessRef || `$${quoteParams.push(businessId)}`}`
    : '';
  const quotation = (
    await pool.query(
      `select q.*, c.id as customer_id, c.name as customer_name
         from quotations q
         left join customers c on c.id = q.customer_id${customerBusinessJoin}
        where q.id=$1${quoteBusinessRef ? ` and q.business_id = ${quoteBusinessRef}` : ''}${
        !quoteBusinessRef && hasCustomerBusiness ? ' and c.id is not null' : ''
      }
        limit 1`,
      quoteParams
    )
  ).rows[0];
  if (!quotation) {
    return NextResponse.json({ ok: false, error: 'Quotation not found' }, { status: 404 });
  }

  // Load items
  const itemParams: unknown[] = [qid];
  const itemBusinessFilter = hasQuotationItemsBusiness ? ` and business_id = $${itemParams.push(businessId)}` : '';
  const qItems = (
    await pool.query(
      `select id, description, qty, price, tax, discount, product_id
         from quotation_items
        where quotation_id = $1${itemBusinessFilter}
        order by id asc`,
      itemParams
    )
  ).rows;

  if (!qItems.length) {
    return NextResponse.json({ ok: false, error: 'Quotation has no items' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const salesCols = await getColumns(client, "sales").catch(() => new Set<string>());
    const invoice_no = await getNextInvoiceNo(client, salesCols, businessId, hasSalesBusiness).catch(() => null);

    const meta = {
      source_quotation_id: quotation.id,
      source_quotation_number: quotation.quotation_number ?? null,
      amount_paid: 0,
      is_return: false,
      notes: quotation?.meta?.notes ?? null,
      ...(invoice_no ? { invoice_no } : {}),
    };

    const saleCols: string[] = [];
    const saleValues: any[] = [];
    const salePlaceholders: string[] = [];
    const addVal = (col: string, val: any, cast?: string) => {
      saleCols.push(col);
      saleValues.push(val);
      salePlaceholders.push(`$${saleValues.length}${cast ? `::${cast}` : ""}`);
    };
    const addNow = (col: string) => {
      saleCols.push(col);
      salePlaceholders.push("now()");
    };

    if (hasSalesBusiness) addVal("business_id", businessId);
    if (invoice_no && salesCols.has("invoice_no")) addVal("invoice_no", invoice_no);
    addVal("customer_id", quotation.customer_id ?? null);
    addNow("invoice_date");
    addVal("subtotal", 0);
    addVal("tax_total", 0);
    addVal("total", 0);
    addVal("meta", JSON.stringify(meta), "jsonb");
    addNow("created_at");

    const saleRow = (
      await client.query(
        `insert into sales (${saleCols.join(', ')})
         values (${salePlaceholders.join(', ')})
         returning id`,
        saleValues
      )
    ).rows[0];
    const saleId = saleRow.id;

    let subtotal = 0, tax_total = 0, total = 0;

    for (const it of qItems) {
      const name = String(it.description ?? '').trim() || 'Item';
      const qty = clamp(toNum(it.qty, 0), 0, 1e9);
      const unit_price = clamp(toNum(it.price, 0), 0, 1e9);

      // Discount: quotation.discount may be % or absolute (>100). Convert to % safely.
      const gross = qty * unit_price;
      let discount_pct = 0;
      if (gross > 0) {
        const rawDisc = toNum(it.discount, 0);
        const discAbs = rawDisc > 0 ? (rawDisc <= 100 ? gross * (rawDisc / 100) : rawDisc) : 0;
        discount_pct = clamp((discAbs / gross) * 100, 0, 100);
      }

      // GST: quotation.tax should be a %, but if it’s out-of-range, clamp to 0..100 to avoid DB overflow
      const gst_slab = clamp(toNum(it.tax, 0), 0, 100); // change to 28 if you want only 0..28

      const discount = gross * (discount_pct / 100);
      const taxable = Math.max(0, gross - discount);
      const tax = taxable * (gst_slab / 100);
      const lineTotal = taxable + tax;

      subtotal += taxable;
      tax_total += tax;
      total += lineTotal;

      // Guard against absurdly large money figures that could overflow narrow NUMERIC columns
      const taxableSafe = clamp(round2(taxable), -9_999_999_999, 9_999_999_999);
      const taxSafe     = clamp(round2(tax),     -9_999_999_999, 9_999_999_999);
      const totalSafe   = clamp(round2(lineTotal), -9_999_999_999, 9_999_999_999);

      if (hasSaleItemsBusiness) {
        await client.query(
          `insert into sale_items (business_id, sale_id, name, gst_slab, qty, unit_price, discount_pct, taxable, tax, total)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            businessId,
            saleId,
            name,
            round2(gst_slab),
            round2(qty),
            round2(unit_price),
            round2(discount_pct),
            taxableSafe,
            taxSafe,
            totalSafe,
          ]
        );
      } else {
        await client.query(
          `insert into sale_items (sale_id, name, gst_slab, qty, unit_price, discount_pct, taxable, tax, total)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            saleId,
            name,
            round2(gst_slab),
            round2(qty),
            round2(unit_price),
            round2(discount_pct),
            taxableSafe,
            taxSafe,
            totalSafe,
          ]
        );
      }
    }

    if (hasSalesBusiness) {
      await client.query(
        `update sales
            set subtotal=$2, tax_total=$3, total=$4
          where id=$1 and business_id = $5`,
        [saleId, round2(subtotal), round2(tax_total), round2(total), businessId]
      );
    } else {
      await client.query(
        `update sales
            set subtotal=$2, tax_total=$3, total=$4
          where id=$1`,
        [saleId, round2(subtotal), round2(tax_total), round2(total)]
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, sale_id: saleId, redirect: `/invoices/${saleId}` });
  } catch (e: any) {
    await client.query('ROLLBACK');
    return NextResponse.json(
      { ok: false, error: e?.message || 'Failed to convert this quotation' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  return POST(req, ctx);
}
