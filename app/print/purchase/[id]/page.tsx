export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { notFound } from "next/navigation";
import { pool } from "@/lib/db";
import PrintPickerClient from "@/print/_components/PrintPickerClient";

function fmtDate(v?: string | null) {
  if (!v) return "";
  try {
    return new Date(v).toLocaleDateString("en-IN");
  } catch {
    return String(v);
  }
}

export default async function PurchasePrintPickerPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const rs = await pool.query(
    `SELECT id,
            COALESCE(invoice_no, bill_no) AS invoice_no,
            COALESCE(to_char(invoice_date, 'YYYY-MM-DD'), to_char(bill_date, 'YYYY-MM-DD')) AS invoice_date,
            created_at
       FROM purchases
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  if (rs.rowCount === 0) notFound();
  const p = rs.rows[0] as any;

  return (
    <PrintPickerClient
      title={`Print Purchase ${p.invoice_no ?? `#${p.id}`}`}
      subtitle={`Date: ${fmtDate(p.invoice_date || p.created_at)}`}
      backHref={`/inventory/purchases/${id}`}
      backLabel="Back to Purchase"
      a4IframeSrc={`/api/purchases/${id}/pdf`}
      thermalIframeSrc={`/print/purchase/${id}/thermal?embed=1`}
      pdfDownloadSrc={`/api/purchases/${id}/pdf`}
      pdfFallbackName={`purchase-${p.invoice_no || p.id}.pdf`}
    />
  );
}
