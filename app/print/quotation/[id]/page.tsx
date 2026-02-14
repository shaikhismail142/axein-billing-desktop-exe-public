export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "@/lib/db";

function fmtDate(v?: string | null) {
  if (!v) return "";
  try {
    return new Date(v).toLocaleDateString("en-IN");
  } catch {
    return String(v);
  }
}

export default async function QuotationPrintPickerPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const rs = await pool.query(
    `SELECT id, quotation_number, quotation_date, valid_until
       FROM quotations
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  if (rs.rowCount === 0) notFound();
  const q = rs.rows[0] as any;

  return (
    <div className="container">
      <div className="card" style={{ padding: 16 }}>
        <h1 style={{ margin: 0 }}>Print Quotation {q.quotation_number ?? `#${q.id}`}</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Date: {fmtDate(q.quotation_date)}
          {q.valid_until ? ` • Valid until: ${fmtDate(q.valid_until)}` : ""}
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
          <h3 style={{ margin: 0 }}>A4 (PDF)</h3>
          <p className="muted" style={{ marginTop: 8 }}>
            Standard quotation PDF for A4 printers.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <a className="btn" href={`/api/quotations/${id}/pdf`} target="_blank" rel="noopener">
              Open PDF Preview
            </a>
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <h3 style={{ margin: 0 }}>Thermal (Receipt)</h3>
          <p className="muted" style={{ marginTop: 8 }}>
            Compact receipt format for thermal printers.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <a className="btn" href={`/print/quotation/${id}/thermal`} target="_blank" rel="noopener">
              Open Thermal Preview
            </a>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Link className="glass-btn" href={`/quotations/${id}`}>
          ← Back to Quotation
        </Link>
      </div>
    </div>
  );
}

