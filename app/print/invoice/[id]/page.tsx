export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "@/lib/db";

function fmtDate(v?: string | null) {
  if (!v) return "";
  try {
    return new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  } catch {
    return String(v);
  }
}

export default async function InvoicePrintPickerPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const rs = await pool.query(
    `SELECT id, invoice_no, invoice_date, created_at
       FROM sales
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  if (rs.rowCount === 0) notFound();
  const inv = rs.rows[0] as any;
  const displayDate = inv.invoice_date || inv.created_at;

  return (
    <div className="container">
      <div className="card" style={{ padding: 16 }}>
        <h1 style={{ margin: 0 }}>Print Invoice {inv.invoice_no ?? `#${inv.id}`}</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Date: {fmtDate(displayDate)}
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
          marginTop: 12,
        }}
      >
        <div className="card" style={{ padding: 14 }}>
          <h3 style={{ margin: 0 }}>A4 (Full Invoice)</h3>
          <p className="muted" style={{ marginTop: 8 }}>
            Standard invoice layout for A4 printers and PDF export.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <a className="btn" href={`/invoices/${id}/print`} target="_blank" rel="noopener">
              Open A4 Preview
            </a>
            <a className="btn" href={`/api/invoices/${id}/pdf`} target="_blank" rel="noopener">
              Download PDF
            </a>
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <h3 style={{ margin: 0 }}>Thermal (Receipt)</h3>
          <p className="muted" style={{ marginTop: 8 }}>
            Compact receipt format for 80mm / 58mm thermal printers.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <a className="btn" href={`/print/invoice/${id}/thermal`} target="_blank" rel="noopener">
              Open Thermal Preview
            </a>
          </div>
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Tip: set printer paper width to match your device.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Link className="glass-btn" href={`/invoices/${id}`}>
          ← Back to Invoice
        </Link>
      </div>
    </div>
  );
}

