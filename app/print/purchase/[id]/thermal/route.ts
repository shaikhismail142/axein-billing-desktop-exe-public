export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function inr(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  const amt = v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `INR (Rs/-) ${amt}`;
}

function escapeHtml(input: unknown) {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(v?: any) {
  if (!v) return "";
  try {
    return new Date(v).toLocaleDateString("en-IN");
  } catch {
    return String(v);
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return new NextResponse("Invalid purchase id", { status: 400 });
  }
  const url = new URL(req.url);
  const embed = url.searchParams.get("embed") === "1";

  let biz: any = {
    name: "Your Shop Name",
    address: "",
    phone: "",
    gstin: "",
  };
  try {
    const rs = await pool.query(`SELECT value_json FROM settings WHERE key='business' LIMIT 1`);
    const v = rs.rows?.[0]?.value_json;
    if (v && typeof v === "object") biz = { ...biz, ...v };
  } catch {}

  const hdrRs = await pool.query(`SELECT * FROM purchases WHERE id = $1 LIMIT 1`, [id]);
  if (hdrRs.rowCount === 0) return new NextResponse("Purchase not found", { status: 404 });
  const p = hdrRs.rows[0] as any;

  let supplierName = "";
  try {
    if (p.supplier_id) {
      const sup = await pool.query(`SELECT name FROM suppliers WHERE id = $1 LIMIT 1`, [p.supplier_id]);
      supplierName = String(sup.rows?.[0]?.name || "");
    }
  } catch {}

  const items = (await pool.query(`SELECT * FROM purchase_items WHERE purchase_id = $1 ORDER BY id`, [id]))
    .rows as any[];

  const meta = (p.meta && typeof p.meta === "object" ? p.meta : {}) as Record<string, any>;
  const invoiceNo = p.invoice_no ?? p.bill_no ?? `#${p.id}`;
  const invoiceDate = p.invoice_date ?? p.bill_date ?? p.created_at ?? null;
  const total = Number(p.total_amount ?? p.grand_total ?? p.total ?? 0);
  const tax = Number(p.total_tax ?? p.tax_total ?? 0);
  const paid = Number(p.amount_paid ?? meta.amount_paid ?? 0);
  const pending = Number(
    p.pending_amount ?? meta.pending_amount ?? Math.max(round2(total - paid), 0)
  );
  const status =
    String(p.payment_status ?? meta.payment_status ?? "")
      .trim()
      .toUpperCase() ||
    (pending <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "PENDING");
  const method = p.payment_method ?? meta.payment_method ?? "";

  const lines = items.map((it: any) => {
    const qty = Number(it.qty ?? 0);
    const rate = Number(it.cost_price ?? it.purchase_rate ?? it.unit_price ?? 0);
    const name = it.description ?? it.product_label ?? it.product_name ?? it.product_id ?? "Item";
    const amt = round2(qty * rate);
    return { name: String(name || "Item"), qty, rate, amt };
  });

  const controlsHtml = embed
    ? ""
    : `<div class="noprint">
         <button onclick="window.print()" style="border:1px solid #cbd5e1; padding:6px 10px; border-radius:10px; background:#fff;">Print</button>
         <button onclick="window.close()" style="border:1px solid #cbd5e1; padding:6px 10px; border-radius:10px; background:#fff;">Close</button>
       </div>`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Purchase ${escapeHtml(invoiceNo)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      margin: 0;
      color: #0b1220;
      font-size: 12px;
      line-height: 1.25;
    }
    .noprint { display:flex; gap:8px; margin: 0 0 8px 0; }
    @media print {
      .noprint { display:none !important; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    .center { text-align:center; }
    .right { text-align:right; }
    .muted { opacity: 0.75; }
    .hr { border-top: 1px dashed #94a3b8; margin: 8px 0; }
    h1 { font-size: 14px; margin: 0; font-weight: 800; letter-spacing: 0.08em; }
    .biz { font-weight: 800; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 2px 0; vertical-align: top; }
    th { font-size: 11px; opacity: .8; border-bottom: 1px dashed #94a3b8; padding-bottom: 4px; }
    .col-item { width: 54%; }
    .col-qty { width: 14%; }
    .col-rate { width: 16%; }
    .col-amt { width: 16%; }
    .item { word-break: break-word; }
    .totals { margin-top: 6px; }
    .totals .row { display:flex; justify-content: space-between; margin: 2px 0; }
    .badge { display:inline-block; padding: 2px 6px; border: 1px solid #cbd5e1; border-radius: 9999px; font-weight: 800; font-size: 11px; }
  </style>
</head>
<body>
  ${controlsHtml}

  <div class="center">
    <div class="biz">${escapeHtml(biz.name || "Your Shop Name")}</div>
    ${biz.address ? `<div class="muted">${escapeHtml(biz.address)}</div>` : ""}
    ${biz.phone ? `<div class="muted">Phone: ${escapeHtml(biz.phone)}</div>` : ""}
    ${biz.gstin ? `<div class="muted">GSTIN: ${escapeHtml(biz.gstin)}</div>` : ""}
    <div class="hr"></div>
    <h1>PURCHASE</h1>
  </div>

  <div style="margin-top:6px">
    <div><b>No:</b> ${escapeHtml(invoiceNo)}</div>
    <div><b>Date:</b> ${escapeHtml(fmtDate(invoiceDate))}</div>
    ${supplierName ? `<div><b>Supplier:</b> ${escapeHtml(supplierName)}</div>` : ""}
    <div><span class="badge">${escapeHtml(status)}</span></div>
  </div>

  <div class="hr"></div>
  <table>
    <thead>
      <tr>
        <th class="col-item">Item</th>
        <th class="col-qty right">Qty</th>
        <th class="col-rate right">Rate</th>
        <th class="col-amt right">Amt</th>
      </tr>
    </thead>
    <tbody>
      ${lines
        .map((it: any) => {
          return `<tr>
            <td class="item col-item">${escapeHtml(it.name)}</td>
            <td class="right col-qty">${it.qty ? it.qty.toFixed(2) : "0"}</td>
            <td class="right col-rate">${escapeHtml(inr(it.rate))}</td>
            <td class="right col-amt">${escapeHtml(inr(it.amt))}</td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>

  <div class="hr"></div>
  <div class="totals">
    <div class="row"><span>Tax</span><b>${escapeHtml(inr(tax))}</b></div>
    <div class="row" style="border-top: 1px dashed #94a3b8; padding-top: 4px; margin-top: 4px">
      <span>Grand Total</span><b>${escapeHtml(inr(total))}</b>
    </div>
    <div class="row"><span>Paid</span><b>${escapeHtml(inr(paid))}</b></div>
    <div class="row"><span>Balance</span><b>${escapeHtml(inr(pending))}</b></div>
    ${method ? `<div class="row"><span>Method</span><b>${escapeHtml(method)}</b></div>` : ""}
  </div>

  <div class="hr"></div>
  <div class="center muted">Thank you</div>
</body>
</html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
