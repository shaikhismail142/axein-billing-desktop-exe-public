// app/api/sales/[id]/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId } from "@/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

type ReqItem = {
  product_id?: number;
  name: string;
  gst_slab: number;
  qty: number;
  unit_price: number;
  discount_pct: number;
  batch_no?: string | null;
  exp_date?: string | null;
};
type ReqBody = {
  invoice_date?: string | null;
  is_return?: boolean;
  amount_paid?: number;
  payment_method?: string | null;
  customer_id?: number | null;
  customer?: { name: string; phone?: string; gstin?: string; address?: string } | null;
  customer_name?: string | null;
  items?: ReqItem[];
  patient_name?: string | null;
  doctor_name?: string | null;
  dc_no?: string | null;
  notes?: string | null;
  terms?: string | null;
  extra_label?: string | null;
  extra_amount?: number | string | null;
  extra_tax_amount?: number | string | null;
  custom_field_totals?: Record<string, unknown> | null;
  custom_fields?: Record<string, unknown> | null;
};

function nstr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function normalizeCustomFields(input: unknown): Record<string, string | number> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string | number> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = String(rawKey || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50);
    if (!key) continue;

    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      out[key] = rawValue;
      continue;
    }
    const value = nstr(rawValue);
    if (value != null) out[key] = value.slice(0, 200);
  }
  return out;
}

const columnCache = new Map<string, Set<string>>();
async function getColumns(client: any, table: string): Promise<Set<string>> {
  const cached = columnCache.get(table);
  if (cached) return cached;
  const r = await client.query(
    `SELECT LOWER(column_name) AS col
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  const cols = new Set<string>(r.rows.map((x: any) => x.col));
  columnCache.set(table, cols);
  return cols;
}

type ProductCols = { hasMeta: boolean; hasStockQty: boolean; hasStock: boolean };

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAnyPermission(
    req,
    ["perm.sales.manage", "perm.payments.manage", "perm.customers.manage", "perm.products.manage"],
    "Forbidden"
  );
  if ("response" in access) return access.response;

  const saleId = Number(params.id);
  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  if (!Number.isFinite(saleId)) return NextResponse.json({ error: "Invalid sale id" }, { status: 400 });

  let body: ReqBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return NextResponse.json({ error: "At least one item required." }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const salesCols = await getColumns(client, "sales");
    const saleItemCols = await getColumns(client, "sale_items");
    const productCols = await getColumns(client, "products");
    const customerCols = await getColumns(client, "customers");
    let salePaymentCols = new Set<string>();
    try { salePaymentCols = await getColumns(client, "sale_payments"); } catch {}
    const hasSalesBusiness = salesCols.has("business_id");
    const hasSaleItemsBusiness = saleItemCols.has("business_id");
    const hasProductsBusiness = productCols.has("business_id");
    const hasCustomersBusiness = customerCols.has("business_id");
    const hasSalePaymentsBusiness = salePaymentCols.has("business_id");
    const prodCols: ProductCols = {
      hasMeta: productCols.has("meta"),
      hasStockQty: productCols.has("stock_qty"),
      hasStock: productCols.has("stock"),
    };
    const salesHasMeta = salesCols.has("meta");

    // Read current for stock diff + meta
    const curSelectCols = ["id"];
    if (salesHasMeta) curSelectCols.push("meta");
    if (salesCols.has("amount_paid")) curSelectCols.push("amount_paid");
    if (salesCols.has("payment_method")) curSelectCols.push("payment_method");
    if (salesCols.has("payment_status")) curSelectCols.push("payment_status");
    const curSale = await client.query(
      `SELECT ${curSelectCols.join(", ")} FROM sales WHERE id=$1${
        hasSalesBusiness ? " AND business_id = $2" : ""
      } FOR UPDATE`,
      hasSalesBusiness ? [saleId, businessId] : [saleId]
    );
    if (!curSale.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    const curRow = curSale.rows[0] as any;
    const curMeta = salesHasMeta ? ((curRow.meta ?? {}) as Record<string, any>) : {};
    const prevIsReturn = salesHasMeta ? !!curMeta.is_return : false;

    const prevItems = await client.query(
      `SELECT name, qty FROM sale_items WHERE sale_id=$1${
        hasSaleItemsBusiness ? " AND business_id = $2" : ""
      }`,
      hasSaleItemsBusiness ? [saleId, businessId] : [saleId]
    );

    // Undo previous stock effects
    for (const row of prevItems.rows) {
      await adjustStockForItem(
        client,
        { name: row.name },
        Number(row.qty),
        prevIsReturn ? -1 : +1,
        prodCols,
        businessId,
        hasProductsBusiness
      );
    }

    // Replace items
    await client.query(
      `DELETE FROM sale_items WHERE sale_id=$1${hasSaleItemsBusiness ? " AND business_id = $2" : ""}`,
      hasSaleItemsBusiness ? [saleId, businessId] : [saleId]
    );

    let subtotal = 0, tax_total_items = 0, total_items = 0;
    for (const it of items) {
      if (!it.name || isNaN(+it.qty) || isNaN(+it.unit_price))
        return NextResponse.json({ error: "Invalid item values." }, { status: 400 });

      const qty = +it.qty || 0;
      const rate = +it.unit_price || 0;
      const disc = +it.discount_pct || 0;
      const gst = +it.gst_slab || 0;

      const gross = qty * rate;
      const discount = (gross * disc) / 100;
      const taxable = gross - discount;
      const tax = (taxable * gst) / 100;
      const lineTotal = taxable + tax;

      subtotal += taxable; tax_total_items += tax; total_items += lineTotal;

      const itemMeta = {
        ...(it.batch_no ? { batch_no: String(it.batch_no).trim() } : {}),
        ...(it.exp_date ? { exp_date: String(it.exp_date).trim() } : {}),
      };
      const itemCols: string[] = [];
      const itemVals: any[] = [];
      const addItem = (col: string, val: any) => {
        if (saleItemCols.has(col)) { itemCols.push(col); itemVals.push(val); }
      };
      if (hasSaleItemsBusiness) addItem("business_id", businessId);
      addItem("sale_id", saleId);
      addItem("product_id", it.product_id ?? null);
      addItem("name", it.name.trim());
      addItem("hsn_code", null);
      addItem("gst_slab", gst);
      addItem("qty", qty);
      addItem("unit", "pcs");
      addItem("unit_price", rate);
      addItem("discount_pct", disc);
      addItem("taxable", round2(taxable));
      addItem("tax", round2(tax));
      if (saleItemCols.has("cgst")) addItem("cgst", round2(tax / 2));
      if (saleItemCols.has("sgst")) addItem("sgst", round2(tax / 2));
      if (saleItemCols.has("igst")) addItem("igst", 0);
      addItem("total", round2(lineTotal));
      if (saleItemCols.has("meta")) addItem("meta", JSON.stringify(itemMeta));

      const ph = itemVals.map((_, i) => `$${i + 1}`).join(", ");
      await client.query(
        `INSERT INTO sale_items (${itemCols.join(", ")}) VALUES (${ph})`,
        itemVals
      );

      // Apply new stock effects
      const nextIsReturn = !!body.is_return;
      await adjustStockForItem(
        client,
        { product_id: it.product_id, name: it.name },
        qty,
        nextIsReturn ? +1 : -1,
        prodCols,
        businessId,
        hasProductsBusiness
      );
    }

    // Totals + meta
    const curExtraAmount = Number(curMeta.extra_amount ?? 0) || 0;
    const curExtraTaxAmount = Number(curMeta.extra_tax_amount ?? 0) || 0;
    const extraAmountRaw = Number(body.extra_amount ?? curExtraAmount) || 0;
    const extraTaxAmountRaw = Number(body.extra_tax_amount ?? curExtraTaxAmount) || 0;
    const sign = body.is_return ? -1 : 1;
    const extraAmount = round2(Math.abs(extraAmountRaw) * sign);
    const extraTaxAmount = round2(Math.abs(extraTaxAmountRaw) * sign);

    let tax_total = round2(tax_total_items + extraTaxAmount);
    let total = round2(total_items + extraAmount + extraTaxAmount);
    if (body.is_return) {
      subtotal = -subtotal;
      tax_total = -Math.abs(tax_total);
      total = -Math.abs(total);
    } else {
      subtotal = round2(subtotal);
      tax_total = round2(tax_total);
      total = round2(total);
    }
    const existingPaid = salesCols.has("amount_paid")
      ? Number(curRow.amount_paid ?? 0)
      : Number(curMeta.amount_paid ?? 0);
    const amountPaid = round2(Number(body.amount_paid ?? existingPaid ?? 0));
    const paid = Math.max(amountPaid, 0);
    const pendingAmount = round2(Math.max(total - paid, 0));
    const paymentStatus =
      paid >= total - 0.01 ? "Paid" : paid > 0 ? "Partial" : "Pending";
    const existingMethod = salesCols.has("payment_method")
      ? (curRow.payment_method ?? null)
      : (curMeta.payment_method ?? null);
    const paymentMethod =
      typeof body.payment_method === "string"
        ? body.payment_method.trim()
        : existingMethod;

    const updateCols: string[] = ["customer_id=$2"];
    const updateVals: any[] = [saleId, await resolveCustomerId(client, body, businessId, hasCustomersBusiness)];
    let idx = 3;

    const addCol = (col: string, val: any) => {
      if (salesCols.has(col)) { updateCols.push(`${col}=$${idx++}`); updateVals.push(val); }
    };

    if (Object.prototype.hasOwnProperty.call(body as any, "invoice_date")) {
      const raw = (body as any).invoice_date;
      if (raw === null) {
        addCol("invoice_date", null);
      } else if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed) {
          addCol("invoice_date", null);
        } else {
          const parsed = new Date(trimmed);
          if (!Number.isFinite(parsed.getTime())) {
            throw new Error("Invalid invoice_date");
          }
          addCol("invoice_date", parsed.toISOString());
        }
      } else if (raw !== undefined) {
        throw new Error("Invalid invoice_date");
      }
    }

    addCol("subtotal", round2(subtotal));
    addCol("tax_total", round2(tax_total));
    addCol("total", round2(total));
    addCol("taxable_value", round2(subtotal));
    addCol("grand_total", round2(total));
    addCol("roundoff", 0);
    addCol("round_off", 0);
    if (salesCols.has("cgst")) addCol("cgst", round2(tax_total / 2));
    if (salesCols.has("sgst")) addCol("sgst", round2(tax_total / 2));
    if (salesCols.has("igst")) addCol("igst", 0);

    addCol("amount_paid", paid);
    addCol("pending_amount", pendingAmount);
    addCol("payment_status", paymentStatus);
    addCol("payment_method", paymentMethod || null);
    const updateWhere = hasSalesBusiness ? `id=$1 AND business_id = $${idx}` : "id=$1";
    if (hasSalesBusiness) updateVals.push(businessId);
    await client.query(`UPDATE sales SET ${updateCols.join(", ")} WHERE ${updateWhere}`, updateVals);

    const curCustomFields =
      curMeta.custom_fields && typeof curMeta.custom_fields === "object" && !Array.isArray(curMeta.custom_fields)
        ? (curMeta.custom_fields as Record<string, unknown>)
        : {};
    const nextCustomFields =
      body.custom_fields && typeof body.custom_fields === "object"
        ? { ...curCustomFields, ...normalizeCustomFields(body.custom_fields) }
        : (curMeta.custom_fields ?? null);

    const newMeta = {
      ...(curMeta || {}),
      is_return: !!body.is_return,
      amount_paid: paid,
      pending_amount: pendingAmount,
      payment_status: paymentStatus,
      payment_method: paymentMethod || null,
      notes: typeof body.notes === "string" ? body.notes : (curMeta.notes ?? null),
      terms: typeof body.terms === "string" ? body.terms : (curMeta.terms ?? null),
      extra_label: typeof body.extra_label === "string" ? body.extra_label : (curMeta.extra_label ?? null),
      extra_amount: extraAmount,
      extra_tax_amount: extraTaxAmount,
      patient_name: typeof body.patient_name === 'string' ? body.patient_name : (curMeta.patient_name ?? null),
      doctor_name: typeof body.doctor_name === 'string' ? body.doctor_name : (curMeta.doctor_name ?? null),
      dc_no: typeof body.dc_no === 'string' ? body.dc_no : (curMeta.dc_no ?? null),
      custom_field_totals:
        body.custom_field_totals && typeof body.custom_field_totals === "object"
          ? body.custom_field_totals
          : (curMeta.custom_field_totals ?? null),
      custom_fields: nextCustomFields,
    };

    if (salesHasMeta) {
      await client.query(
        `UPDATE sales SET meta=$2::jsonb WHERE id=$1${hasSalesBusiness ? " AND business_id = $3" : ""}`,
        hasSalesBusiness ? [saleId, JSON.stringify(newMeta), businessId] : [saleId, JSON.stringify(newMeta)]
      );
    }

    await client.query("COMMIT");

    // Optional: refresh sale_payments AFTER commit (avoid aborting main tx)
    try {
      const hasPayments = await client.query(
        `SELECT to_regclass('public.sale_payments') IS NOT NULL AS ok`
      );
      if (hasPayments.rows?.[0]?.ok) {
        await client.query(
          `DELETE FROM sale_payments WHERE sale_id=$1${hasSalePaymentsBusiness ? " AND business_id = $2" : ""}`,
          hasSalePaymentsBusiness ? [saleId, businessId] : [saleId]
        );
        if (paid > 0) {
          if (hasSalePaymentsBusiness) {
            await client.query(
              `INSERT INTO sale_payments (business_id, sale_id, method, amount, ref)
               VALUES ($1, $2, $3, $4, NULL)`,
              [businessId, saleId, paymentMethod || "cash", paid]
            );
          } else {
            await client.query(
              `INSERT INTO sale_payments (sale_id, method, amount, ref)
               VALUES ($1, $2, $3, NULL)`,
              [saleId, paymentMethod || "cash", paid]
            );
          }
        }
      }
    } catch (e: any) {
      console.warn("sale_payments update skipped:", e?.message || e);
    }
    return NextResponse.json({ ok: true, id: saleId });
  } catch (err: any) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: err?.message || "Failed to update invoice." }, { status: 500 });
  } finally {
    client.release();
  }
}

/** ------- helpers (same as POST) ------- */
async function resolveCustomerId(
  client: any,
  body: { customer_id?: number|null; customer?: any; customer_name?: string|null; },
  businessId: number,
  scopeByBusiness: boolean
) {
  if (body.customer_id) {
    if (!scopeByBusiness) return body.customer_id;
    const scoped = await client.query(
      `SELECT id FROM customers WHERE id = $1 AND business_id = $2 LIMIT 1`,
      [body.customer_id, businessId]
    );
    if (scoped.rowCount) return body.customer_id;
    throw new Error("Customer does not belong to this business");
  }
  const name = (body.customer?.name || body.customer_name || "").trim();
  if (!name) return null;
  const found = scopeByBusiness
    ? await client.query(`SELECT id FROM customers WHERE business_id = $1 AND LOWER(name)=LOWER($2) LIMIT 1`, [businessId, name])
    : await client.query(`SELECT id FROM customers WHERE LOWER(name)=LOWER($1) LIMIT 1`, [name]);
  if (found.rowCount) return found.rows[0].id as number;
  const ins = scopeByBusiness
    ? await client.query(
        `INSERT INTO customers (business_id, name, phone, gstin, address) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [businessId, name, body.customer?.phone ?? null, body.customer?.gstin ?? null, body.customer?.address ?? null]
      )
    : await client.query(
        `INSERT INTO customers (name, phone, gstin, address) VALUES ($1,$2,$3,$4) RETURNING id`,
        [name, body.customer?.phone ?? null, body.customer?.gstin ?? null, body.customer?.address ?? null]
      );
  return ins.rows[0].id as number;
}

async function adjustStockForItem(
  client: any,
  product: { product_id?: number; name: string },
  qty: number,
  direction: 1|-1,
  cols: ProductCols,
  businessId: number,
  scopeByBusiness: boolean
) {
  try {
    let prod = null;
    if (product.product_id) {
      const selectCols = ["id"];
      if (cols.hasMeta) selectCols.push("meta");
      if (cols.hasStockQty) selectCols.push("stock_qty");
      if (cols.hasStock) selectCols.push("stock");
      const r = await client.query(
        `SELECT ${selectCols.join(", ")} FROM products WHERE id=$1${
          scopeByBusiness ? " AND business_id = $2" : ""
        }`,
        scopeByBusiness ? [product.product_id, businessId] : [product.product_id]
      );
      if (r.rowCount) prod = r.rows[0];
    }
    if (!prod) {
      const selectCols = ["id"];
      if (cols.hasMeta) selectCols.push("meta");
      if (cols.hasStockQty) selectCols.push("stock_qty");
      if (cols.hasStock) selectCols.push("stock");
      const r = await client.query(
        `SELECT ${selectCols.join(", ")} FROM products WHERE LOWER(name)=LOWER($1)${
          scopeByBusiness ? " AND business_id = $2" : ""
        } LIMIT 1`,
        scopeByBusiness ? [product.name.trim(), businessId] : [product.name.trim()]
      );
      if (r.rowCount) prod = r.rows[0];
    }
    if (!prod) {
      if (cols.hasMeta) {
        const ins = scopeByBusiness
          ? await client.query(
              `INSERT INTO products (business_id, name, meta) VALUES ($1,$2,'{}'::jsonb) RETURNING id, meta`,
              [businessId, product.name.trim()]
            )
          : await client.query(
              `INSERT INTO products (name, meta) VALUES ($1,'{}'::jsonb) RETURNING id, meta`,
              [product.name.trim()]
            );
        prod = ins.rows[0];
      } else {
        const ins = scopeByBusiness
          ? await client.query(`INSERT INTO products (business_id, name) VALUES ($1,$2) RETURNING id`, [businessId, product.name.trim()])
          : await client.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [product.name.trim()]);
        prod = ins.rows[0];
      }
    }
    const current = cols.hasMeta
      ? Number((prod.meta?.stock_qty ?? 0))
      : cols.hasStockQty
      ? Number(prod.stock_qty ?? 0)
      : cols.hasStock
      ? Number(prod.stock ?? 0)
      : 0;
    const next = current + (direction * qty);
    if (cols.hasMeta) {
      const newMeta = { ...(prod.meta || {}), stock_qty: round2(next) };
      await client.query(
        `UPDATE products SET meta=$2::jsonb WHERE id=$1${scopeByBusiness ? " AND business_id = $3" : ""}`,
        scopeByBusiness ? [prod.id, JSON.stringify(newMeta), businessId] : [prod.id, JSON.stringify(newMeta)]
      );
    } else if (cols.hasStockQty) {
      await client.query(
        `UPDATE products SET stock_qty=$2 WHERE id=$1${scopeByBusiness ? " AND business_id = $3" : ""}`,
        scopeByBusiness ? [prod.id, round2(next), businessId] : [prod.id, round2(next)]
      );
    } else if (cols.hasStock) {
      await client.query(
        `UPDATE products SET stock=$2 WHERE id=$1${scopeByBusiness ? " AND business_id = $3" : ""}`,
        scopeByBusiness ? [prod.id, round2(next), businessId] : [prod.id, round2(next)]
      );
    }
  } catch { /* swallow if no products table */ }
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
