// app/api/quotations/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/app/lib/db';
import { getRequestBusinessId } from '@/app/lib/platform-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

/**
 * GET /api/quotations?q=<search>
 * - Returns latest quotations (limit 200)
 * - Optional `q` matches customer name or quotation_number (ILIKE)
 * - Always returns JSON so pages never crash on res.json()
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const businessId = getRequestBusinessId(req, 1);
  const q = (searchParams.get('q') || '').trim();
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const perPage = Math.min(200, Math.max(1, Number(searchParams.get('perPage') || 20)));
  const offset = (page - 1) * perPage;

  const db = await getDb();

  try {
    const scopedTables = await getBusinessScopedTables(db, ['quotations', 'customers']);
    const hasQuotationBusiness = scopedTables.has('quotations');
    const hasCustomerBusiness = scopedTables.has('customers');
    const hasBusinessScope = hasQuotationBusiness || hasCustomerBusiness;

    const baseParams: unknown[] = [];
    let businessRef: string | null = null;
    if (hasBusinessScope) {
      baseParams.push(businessId);
      businessRef = `$${baseParams.length}`;
    }

    const where: string[] = [];
    if (hasQuotationBusiness && businessRef) {
      where.push(`q.business_id = ${businessRef}`);
    }
    if (!hasQuotationBusiness && hasCustomerBusiness) {
      where.push(`c.id IS NOT NULL`);
    }
    if (q) {
      baseParams.push(`%${q}%`);
      const searchRef = `$${baseParams.length}`;
      where.push(`(c.name ILIKE ${searchRef} OR q.quotation_number ILIKE ${searchRef})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const customerJoin = `LEFT JOIN customers c ON c.id = q.customer_id${
      hasCustomerBusiness && businessRef ? ` AND c.business_id = ${businessRef}` : ''
    }`;

    const countRes = await db.query(
      `
      SELECT COUNT(*)::int AS cnt
      FROM quotations q
      ${customerJoin}
      ${whereSql}
      `,
      baseParams
    );
    const total = countRes.rows?.[0]?.cnt ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / perPage));

    const pageParams = [...baseParams, perPage, offset];
    const limitRef = `$${baseParams.length + 1}`;
    const offsetRef = `$${baseParams.length + 2}`;

    const { rows } = await db.query(
      `
      with base as (
        select
          q.id::int                                   as id,
          q.quotation_number,
          q.quotation_date,
          q.valid_until,
          coalesce(q.meta, '{}'::jsonb)               as meta,
          c.name                                      as customer_name
        from quotations q
        ${customerJoin}
        ${whereSql}
        order by q.quotation_date desc, q.id desc
        limit ${limitRef} offset ${offsetRef}
      )
      select
        b.id,
        b.quotation_number,
        b.quotation_date,
        b.valid_until,
        b.meta,
        b.customer_name,
        coalesce(
          sum(
            /* discounted subtotal */
            (qi.qty * qi.price)
            - case when qi.discount > 0
                   then case when qi.discount <= 100
                             then (qi.qty*qi.price) * (qi.discount/100.0)
                             else qi.discount end
                   else 0 end
            /* + tax on discounted subtotal */
            + (
                ( (qi.qty*qi.price)
                  - case when qi.discount > 0
                         then case when qi.discount <= 100
                                   then (qi.qty*qi.price) * (qi.discount/100.0)
                                   else qi.discount end
                         else 0 end
                ) * (coalesce(qi.tax,0)/100.0)
              )
          ),
          0
        )::float8                                    as total_amount
      from base b
      left join quotation_items qi on qi.quotation_id = b.id
      group by b.id, b.quotation_number, b.quotation_date, b.valid_until, b.meta, b.customer_name
      order by b.quotation_date desc, b.id desc
      `,
      pageParams
    );

    return NextResponse.json(
      { ok: true, data: rows, count: rows.length, total, page, perPage, totalPages },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    console.error('GET /api/quotations failed:', e);
    return NextResponse.json(
      { ok: false, data: [], error: 'failed' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

// ---------- Types ----------
type Item = {
  product_id?: number | null;
  description: string;
  qty: number;     // >= 0
  price: number;   // >= 0
  tax: number;     // percent, >= 0
  discount: number;// either % (<=100) or absolute (>100), >=0
  batch_no?: string | null;
  exp_date?: string | null;
};

// ---------- Helpers ----------
const toNum = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function isValidItems(items: Item[]) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every((it) =>
    typeof it.description === 'string' &&
    Number.isFinite(Number(it.qty)) && Number(it.qty) >= 0 &&
    Number.isFinite(Number(it.price)) && Number(it.price) >= 0 &&
    Number.isFinite(Number(it.tax)) && Number(it.tax) >= 0 &&
    Number.isFinite(Number(it.discount)) && Number(it.discount) >= 0
  );
}

/**
 * Helper: generate daily sequence number like QYYYYMMDD0001
 * NOTE: For bulletproof uniqueness, add once:
 *   CREATE UNIQUE INDEX IF NOT EXISTS uq_quotations_number ON quotations(quotation_number);
 */
async function generateQuotationNumber(
  client: any,
  businessId: number,
  scopeByBusiness: boolean,
  maxRetries = 3
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Compute candidate
    const numRes = scopeByBusiness
      ? await client.query(
          `select 'Q' || to_char(now(), 'YYYYMMDD') ||
                  lpad( (select count(*) + 1
                         from quotations
                         where date_trunc('day', quotation_date) = current_date
                           and business_id = $1)::text
                       , 4, '0') as n`,
          [businessId]
        )
      : await client.query(
          `select 'Q' || to_char(now(), 'YYYYMMDD') ||
                  lpad( (select count(*) + 1
                         from quotations
                         where date_trunc('day', quotation_date) = current_date)::text
                       , 4, '0') as n`
        );
    const candidate: string = numRes.rows[0].n;

    // Quick existence check (use rows.length instead of rowCount)
    const exists = scopeByBusiness
      ? await client.query(
          `select 1 from quotations where quotation_number = $1 and business_id = $2 limit 1`,
          [candidate, businessId]
        )
      : await client.query(`select 1 from quotations where quotation_number = $1 limit 1`, [candidate]);
    if (!exists.rows || exists.rows.length === 0) return candidate;
  }
  // Fallback to time-based suffix (ultra-rare)
  const ts = Date.now().toString().slice(-6);
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
  return `Q${ymd}${ts}`;
}

// ---------- CREATE ----------
export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => ({} as any));
  const businessId = getRequestBusinessId(req, 1);
  const {
    customer_id = null,
    customer_name = null,
    items = [],
    notes = '',
    terms = '',
    valid_until = null, // ISO date or null
  }: {
    customer_id?: number | null;
    customer_name?: string | null;
    items?: Item[];
    notes?: string;
    terms?: string;
    valid_until?: string | null;
  } = payload ?? {};

  if (!isValidItems(items as Item[])) {
    return NextResponse.json({ ok: false, error: 'Invalid or empty items' }, { status: 400 });
  }

  const db = await getDb();
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const scopedTables = await getBusinessScopedTables(client, ['customers', 'quotations', 'quotation_items']);
    const hasCustomerBusiness = scopedTables.has('customers');
    const hasQuotationBusiness = scopedTables.has('quotations');
    const hasQuotationItemBusiness = scopedTables.has('quotation_items');

    // Find-or-create customer if ID not given but name provided
    let customerId: number | null = customer_id ?? null;
    if (customerId && hasCustomerBusiness) {
      const scopedCustomer = await client.query(
        `select id from customers where id = $1 and business_id = $2 limit 1`,
        [customerId, businessId]
      );
      if (!scopedCustomer.rows?.length) {
        await client.query('ROLLBACK');
        return NextResponse.json({ ok: false, error: 'Customer not found for this business' }, { status: 404 });
      }
    }
    if (!customerId && customer_name && String(customer_name).trim() !== '') {
      const name = String(customer_name).trim();
      const found = hasCustomerBusiness
        ? await client.query(
            `select id from customers where business_id = $1 and lower(name)=lower($2) limit 1`,
            [businessId, name]
          )
        : await client.query(`select id from customers where lower(name)=lower($1) limit 1`, [name]);
      if (found.rows && found.rows.length > 0) {
        customerId = found.rows[0].id;
      } else {
        const ins = hasCustomerBusiness
          ? await client.query(
              `insert into customers (business_id, name) values ($1, $2) returning id`,
              [businessId, name]
            )
          : await client.query(`insert into customers (name) values ($1) returning id`, [name]);
        customerId = ins.rows[0].id;
      }
    }

    // Generate quotation number (with basic collision handling)
    const quotation_number = await generateQuotationNumber(client, businessId, hasQuotationBusiness);
    const meta = { notes: notes ?? '', terms: terms ?? '' };

    const qRes = hasQuotationBusiness
      ? await client.query(
          `insert into quotations (business_id, customer_id, quotation_number, quotation_date, valid_until, meta)
           values ($1, $2, $3, now(), $4, $5)
           returning id`,
          [businessId, customerId ?? null, quotation_number, valid_until, meta]
        )
      : await client.query(
          `insert into quotations (customer_id, quotation_number, quotation_date, valid_until, meta)
           values ($1, $2, now(), $3, $4)
           returning id`,
          [customerId ?? null, quotation_number, valid_until, meta]
        );
    const quotation_id: number = qRes.rows[0].id;

    for (const itRaw of items as Item[]) {
      const it = {
        product_id: itRaw.product_id ?? null,
        description: itRaw.description ?? '',
        qty: toNum(itRaw.qty, 0),
        price: toNum(itRaw.price, 0),
        tax: toNum(itRaw.tax, 0),
        discount: toNum(itRaw.discount, 0),
        batch_no: typeof (itRaw as any).batch_no === 'string' ? String((itRaw as any).batch_no).trim() || null : null,
        exp_date: typeof (itRaw as any).exp_date === 'string' ? String((itRaw as any).exp_date).trim() || null : null,
      };

      if (hasQuotationItemBusiness) {
        await client.query(
          `insert into quotation_items (business_id, quotation_id, product_id, description, qty, price, tax, discount, batch_no, exp_date)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            businessId,
            quotation_id,
            it.product_id,
            it.description,
            it.qty,
            it.price,
            it.tax,
            it.discount,
            it.batch_no,
            it.exp_date,
          ]
        );
      } else {
        await client.query(
          `insert into quotation_items (quotation_id, product_id, description, qty, price, tax, discount, batch_no, exp_date)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            quotation_id,
            it.product_id,
            it.description,
            it.qty,
            it.price,
            it.tax,
            it.discount,
            it.batch_no,
            it.exp_date,
          ]
        );
      }
    }

    await client.query('COMMIT');
    return NextResponse.json(
      { ok: true, data: { id: quotation_id, quotation_number } },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    await client.query('ROLLBACK');
    console.error('POST /api/quotations failed:', e);
    return NextResponse.json({ ok: false, error: 'Failed to create quotation' }, { status: 500 });
  } finally {
    client.release();
  }
}
