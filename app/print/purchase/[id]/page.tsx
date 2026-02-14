export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { notFound } from "next/navigation";
import PrintPickerClient from "@/print/_components/PrintPickerClient";
import { ensureActivated } from "@/app/lib/activation-guard";
import { getServerRequestContext } from "@/app/lib/server-request";

function fmtDate(v?: string | null) {
  if (!v) return "";
  try {
    return new Date(v).toLocaleDateString("en-IN");
  } catch {
    return String(v);
  }
}

export default async function PurchasePrintPickerPage({ params }: { params: { id: string } }) {
  await ensureActivated(true);
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) notFound();

  // Use the API route so permissions + schema-compat are enforced consistently.
  const ctx = getServerRequestContext();
  const res = await fetch(`${ctx.baseUrl}/api/purchases/${id}`, {
    cache: "no-store",
    headers: ctx.authHeaders,
  });
  if (!res.ok) notFound();
  const j = await res.json().catch(() => null);
  if (!j?.ok || !j?.purchase) notFound();

  const p = j.purchase as any;
  const meta = (p.meta && typeof p.meta === "object" ? p.meta : {}) as any;
  const invoiceNo = p.invoice_no || meta.invoice_no || `#${p.id || id}`;
  const invoiceDate = p.invoice_date || meta.invoice_date || p.created_at || null;

  return (
    <PrintPickerClient
      title={`Print Purchase ${invoiceNo}`}
      subtitle={`Date: ${fmtDate(invoiceDate)}`}
      backHref={`/inventory/purchases/${id}`}
      backLabel="Back to Purchase"
      a4IframeSrc={`/api/purchases/${id}/pdf`}
      thermalIframeSrc={`/print/purchase/${id}/thermal?embed=1`}
      pdfDownloadSrc={`/api/purchases/${id}/pdf`}
      pdfFallbackName={`purchase-${invoiceNo || p.id || id}.pdf`}
    />
  );
}
