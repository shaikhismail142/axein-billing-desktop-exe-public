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
    <PrintPickerClient
      title={`Print Quotation ${q.quotation_number ?? `#${q.id}`}`}
      subtitle={`Date: ${fmtDate(q.quotation_date)}${q.valid_until ? ` • Valid until: ${fmtDate(q.valid_until)}` : ""}`}
      backHref={`/quotations/${id}`}
      backLabel="Back to Quotation"
      a4IframeSrc={`/api/quotations/${id}/pdf`}
      thermalIframeSrc={`/print/quotation/${id}/thermal?embed=1`}
      pdfDownloadSrc={`/api/quotations/${id}/pdf`}
      pdfFallbackName={`quotation-${q.quotation_number || q.id}.pdf`}
    />
  );
}
