export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { formatDocumentDate, formatIssuedAtIST } from "@/app/lib/document-timestamp";

function inr(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  const amt = v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Rs ${amt}`;
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
    return new NextResponse("Invalid invoice id", { status: 400 });
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

  const saleRs = await pool.query(
    `SELECT s.id, s.invoice_no, s.created_at, s.issued_at, s.invoice_date,
            s.subtotal, s.tax_total, s.total,
            COALESCE(s.amount_paid, (s.meta->>'amount_paid')::numeric, 0)   AS amount_paid,
            COALESCE(s.pending_amount,
                     GREATEST(s.total - COALESCE(s.amount_paid, (s.meta->>'amount_paid')::numeric, 0), 0)) AS pending_amount,
            COALESCE(NULLIF(s.payment_status,''), (s.meta->>'payment_status')) AS payment_status,
            COALESCE(NULLIF(s.payment_method,''), (s.meta->>'payment_method')) AS payment_method,
            c.name AS customer_name,
            c.phone AS customer_phone
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id = $1
      LIMIT 1`,
    [id]
  );
  if (saleRs.rowCount === 0) return new NextResponse("Invoice not found", { status: 404 });
  const s = saleRs.rows[0] as any;

  const items = (
    await pool.query(
      `SELECT si.id, si.name, si.qty, si.unit_price, si.total
         FROM sale_items si
        WHERE si.sale_id = $1
        ORDER BY si.id`,
      [id]
    )
  ).rows as any[];

  const displayDate = s.invoice_date ?? s.created_at;
  const balanceDue = Number(s.pending_amount ?? 0);
  const payStatus = String(s.payment_status || "")
    .trim()
    .toUpperCase();

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
  <title>Invoice ${escapeHtml(s.invoice_no ?? id)}</title>
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
      <h1>INVOICE</h1>
    </div>

    <div style="margin-top:6px">
      <div><b>No:</b> ${escapeHtml(s.invoice_no ?? id)}</div>
      <div><b>Date:</b> ${escapeHtml(formatDocumentDate(displayDate))}</div>
      <div><b>Issued:</b> ${escapeHtml(formatIssuedAtIST(s.issued_at))}</div>
      <div><span class="badge">${escapeHtml(payStatus || "PENDING")}</span></div>
    </div>

    ${
      s.customer_name
        ? `<div class="hr"></div>
           <div><b>Customer:</b> ${escapeHtml(s.customer_name)}</div>
           ${s.customer_phone ? `<div class="muted">Phone: ${escapeHtml(s.customer_phone)}</div>` : ""}`
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
        ${items
          .map((it: any) => {
            const qty = Number(it.qty || 0);
            const rate = Number(it.unit_price || 0);
            const amt = Number(it.total ?? qty * rate);
            return `<tr>
              <td class="item col-item">${escapeHtml(it.name || "")}</td>
              <td class="right col-qty">${qty ? qty.toFixed(2) : "0"}</td>
              <td class="right col-rate">${escapeHtml(inr(rate))}</td>
              <td class="right col-amt">${escapeHtml(inr(amt))}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>

    <div class="hr"></div>
    <div class="totals">
      <div class="row"><span>Taxable</span><b>${escapeHtml(inr(s.subtotal))}</b></div>
      <div class="row"><span>Tax</span><b>${escapeHtml(inr(s.tax_total))}</b></div>
      <div class="row" style="border-top: 1px dashed #94a3b8; padding-top: 4px; margin-top: 4px">
        <span>Grand Total</span><b>${escapeHtml(inr(s.total))}</b>
      </div>
      <div class="row"><span>Paid</span><b>${escapeHtml(inr(s.amount_paid))}</b></div>
      <div class="row"><span>Balance</span><b>${escapeHtml(inr(balanceDue))}</b></div>
      ${s.payment_method ? `<div class="row"><span>Method</span><b>${escapeHtml(s.payment_method)}</b></div>` : ""}
    </div>

    <div class="hr"></div>
    <div class="center muted">Thank you</div>
  </div>
</body>
</html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
