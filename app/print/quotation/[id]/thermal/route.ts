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
  return `Rs ${amt}`;
}

function fmtDate(v?: string | null) {
  if (!v) return "";
  try {
    return new Date(v).toLocaleDateString("en-IN");
  } catch {
    return String(v);
  }
}

function escapeHtml(input: unknown) {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return new NextResponse("Invalid quotation id", { status: 400 });
  }
  const url = new URL(req.url);
  const embed = url.searchParams.get("embed") === "1";
  const paperMm = url.searchParams.get("paper") === "58" ? 58 : 80;
  const paperCss = `${paperMm}mm`;
  const is58 = paperMm === 58;

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

  const qRs = await pool.query(
    `SELECT q.id, q.quotation_number, q.quotation_date, q.valid_until,
            q.meta,
            c.name AS customer_name,
            c.phone AS customer_phone
       FROM quotations q
       LEFT JOIN customers c ON c.id = q.customer_id
      WHERE q.id = $1
      LIMIT 1`,
    [id]
  );
  if (qRs.rowCount === 0) return new NextResponse("Quotation not found", { status: 404 });
  const q = qRs.rows[0] as any;

  const items = (
    await pool.query(
      `SELECT id, description, qty, price, tax, discount
         FROM quotation_items
        WHERE quotation_id = $1
        ORDER BY id`,
      [id]
    )
  ).rows as any[];

  let subtotal = 0;
  let taxTotal = 0;
  let grand = 0;

  const lines = items.map((it: any) => {
    const qty = Number(it.qty || 0);
    const rate = Number(it.price || 0);
    const gst = Number(it.tax || 0);
    const discRaw = Number(it.discount || 0);
    const gross = qty * rate;
    const discAbs = discRaw > 0 ? (discRaw <= 100 ? gross * (discRaw / 100) : discRaw) : 0;
    const taxable = round2(Math.max(0, gross - discAbs));
    const tax = round2((gst / 100) * taxable);
    const total = round2(taxable + tax);
    subtotal += taxable;
    taxTotal += tax;
    grand += total;
    return { name: it.description || "Item", qty, rate, total };
  });

  subtotal = round2(subtotal);
  taxTotal = round2(taxTotal);
  grand = round2(grand);

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
  <title>Quotation ${escapeHtml(q.quotation_number ?? id)}</title>
  <style>
    @page { size: ${paperCss} auto; margin: ${is58 ? "3mm" : "4mm"}; }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      margin: 0;
      color: #0b1220;
      font-size: ${is58 ? "10.5px" : "12px"};
      line-height: 1.25;
      font-variant-numeric: tabular-nums;
    }
    .paper { width: ${paperCss}; margin: ${embed ? "0" : "12px auto"}; }
    @media print { .paper { width: auto; margin: 0; } }
    .noprint { display:flex; gap:8px; margin: 0 0 8px 0; }
    @media print {
      .noprint { display:none !important; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    .center { text-align:center; }
    .right { text-align:right; }
    .muted { opacity: 0.75; }
    .hr { border-top: 1px dashed #94a3b8; margin: 8px 0; }
    h1 { font-size: ${is58 ? "12px" : "14px"}; margin: 0; font-weight: 800; letter-spacing: 0.08em; }
    .biz { font-weight: 800; font-size: ${is58 ? "12px" : "13px"}; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 2px 0; vertical-align: top; }
    th { font-size: 11px; opacity: .8; border-bottom: 1px dashed #94a3b8; padding-bottom: 4px; }
    .col-item { width: ${is58 ? "44%" : "48%"}; }
    .col-qty { width: 14%; }
    .col-rate { width: 18%; }
    .col-amt { width: 20%; }
    .item { word-break: break-word; }
    .totals { margin-top: 6px; }
    .totals .row { display:flex; justify-content: space-between; margin: 2px 0; }
    .badge { display:inline-block; padding: 2px 6px; border: 1px solid #cbd5e1; border-radius: 9999px; font-weight: 800; font-size: 11px; }
  </style>
</head>
<body>
  ${controlsHtml}

  <div class="paper">
    <div class="center">
      <div class="biz">${escapeHtml(biz.name || "Your Shop Name")}</div>
      ${biz.address ? `<div class="muted">${escapeHtml(biz.address)}</div>` : ""}
      ${biz.phone ? `<div class="muted">Phone: ${escapeHtml(biz.phone)}</div>` : ""}
      ${biz.gstin ? `<div class="muted">GSTIN: ${escapeHtml(biz.gstin)}</div>` : ""}
      <div class="hr"></div>
      <h1>QUOTATION</h1>
    </div>

    <div style="margin-top:6px">
      <div><b>No:</b> ${escapeHtml(q.quotation_number ?? id)}</div>
      <div><b>Date:</b> ${escapeHtml(fmtDate(q.quotation_date))}</div>
      ${q.valid_until ? `<div><b>Valid Until:</b> ${escapeHtml(fmtDate(q.valid_until))}</div>` : ""}
      <div><span class="badge">QUOTE</span></div>
    </div>

    ${
      q.customer_name
        ? `<div class="hr"></div>
           <div><b>Customer:</b> ${escapeHtml(q.customer_name)}</div>
           ${q.customer_phone ? `<div class="muted">Phone: ${escapeHtml(q.customer_phone)}</div>` : ""}`
        : ""
    }

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
              <td class="right col-amt">${escapeHtml(inr(it.total))}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>

    <div class="hr"></div>
    <div class="totals">
      <div class="row"><span>Taxable</span><b>${escapeHtml(inr(subtotal))}</b></div>
      <div class="row"><span>Tax</span><b>${escapeHtml(inr(taxTotal))}</b></div>
      <div class="row" style="border-top: 1px dashed #94a3b8; padding-top: 4px; margin-top: 4px">
        <span>Grand Total</span><b>${escapeHtml(inr(grand))}</b>
      </div>
    </div>

    <div class="hr"></div>
    <div class="center muted">Thank you</div>
  </div>
</body>
</html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
