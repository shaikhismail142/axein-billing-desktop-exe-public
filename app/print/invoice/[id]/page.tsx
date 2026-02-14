export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { notFound } from "next/navigation";
import { pool } from "@/lib/db";
import PrintPickerClient from "@/print/_components/PrintPickerClient";

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
    <PrintPickerClient
      title={`Print Invoice ${inv.invoice_no ?? `#${inv.id}`}`}
      subtitle={`Date: ${fmtDate(displayDate)}`}
      backHref={`/invoices/${id}`}
      backLabel="Back to Invoice"
      a4IframeSrc={`/invoices/${id}/print?embed=1`}
      thermalIframeSrc={`/print/invoice/${id}/thermal?embed=1`}
      pdfDownloadSrc={`/api/invoices/${id}/pdf`}
      pdfFallbackName={`invoice-${inv.invoice_no || inv.id}.pdf`}
    />
  );
}
