export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest } from "next/server";
import PDFDocument from "pdfkit";
import { getTaxReport } from "@/app/lib/tax-report";
import { requireRevenueAccess } from "@/app/lib/request-access";

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes("\"")) {
    return `"${s.replace(/\"/g, '""')}"`;
  }
  return s;
}

function inr(n: number) {
  return `INR (Rs/-) ${Number(n || 0).toFixed(2)}`;
}

async function buildTaxPdf(data: Awaited<ReturnType<typeof getTaxReport>>, group: "month" | "quarter", includeDraft: boolean) {
  const { summary, months } = data;
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const chunks: Uint8Array[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : new Uint8Array(chunk)));

  doc.fontSize(18).text("AxEin GST Summary Report", { align: "center" });
  doc.moveDown(0.8);
  doc.fontSize(10);
  doc.text(`Period: ${data.from} to ${data.to}`);
  doc.text(`Grouping: ${group === "quarter" ? "Quarterly" : "Monthly"}`);
  doc.text(`Draft Purchases: ${includeDraft ? "Included" : "Excluded"}`);
  doc.text(`Generated: ${new Date().toISOString()}`);
  doc.moveDown(0.8);

  doc.fontSize(12).text("Summary");
  doc.moveDown(0.3);
  doc.fontSize(10);
  doc.text(`Output GST (Sales): ${inr(summary.output_tax)}`);
  doc.text(`Input GST (Purchases/ITC): ${inr(summary.input_tax)}`);
  doc.text(`Net GST (${summary.status}): ${inr(summary.net_tax)}`);
  doc.moveDown(0.8);

  doc.fontSize(12).text("Period-wise Breakdown");
  doc.moveDown(0.4);
  doc.fontSize(9).font("Courier");
  doc.text("Period                         Output GST       Input GST        Net GST");
  doc.text("--------------------------------------------------------------------------");
  for (const row of months) {
    const period = String(row.label || row.period || "").padEnd(30, " ").slice(0, 30);
    const output = Number(row.output_tax || 0).toFixed(2).padStart(12, " ");
    const input = Number(row.input_tax || 0).toFixed(2).padStart(12, " ");
    const net = Number(row.net_tax || 0).toFixed(2).padStart(12, " ");
    doc.text(`${period} ${output} ${input} ${net}`);
  }
  if (months.length === 0) {
    doc.text("No rows available for selected range.");
  }
  doc.font("Helvetica");

  return await new Promise<Uint8Array>((resolve, reject) => {
    doc.on("end", () => {
      const totalSize = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
      const merged = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(merged);
    });
    doc.on("error", reject);
    doc.end();
  });
}

export async function GET(req: NextRequest) {
  const access = await requireRevenueAccess(req);
  if ("response" in access) return access.response;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const group = url.searchParams.get("group") === "quarter" ? "quarter" : "month";
  const includeDraft = url.searchParams.get("includeDraft") === "1";
  const format = (url.searchParams.get("format") || "csv").toLowerCase();

  const data = await getTaxReport(from, to, {
    group,
    includeDraft,
    businessId: access.ctx.businessId,
  });
  const { summary, months } = data;
  if (format === "pdf") {
    const pdf = await buildTaxPdf(data, group, includeDraft);
    const filename = `axein-gst-report-${data.from}_to_${data.to}.pdf`;
    const body = pdf as unknown as BodyInit;
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const lines: string[] = [];
  lines.push(`GST Summary Report`);
  lines.push(`Period,${csvEscape(data.from)} to ${csvEscape(data.to)}`);
  lines.push(`Grouping,${group === "quarter" ? "Quarterly" : "Monthly"}`);
  lines.push(`Draft Purchases,${includeDraft ? "Included" : "Excluded"}`);
  lines.push("");
  lines.push(`Output GST (Sales),${summary.output_tax.toFixed(2)}`);
  lines.push(`Input GST (Purchases/ITC),${summary.input_tax.toFixed(2)}`);
  lines.push(`Net GST (${summary.status}),${summary.net_tax.toFixed(2)}`);
  lines.push("");
  lines.push(`Period,Output GST,Input GST,Net GST`);
  for (const m of months) {
    lines.push([
      csvEscape(m.label),
      m.output_tax.toFixed(2),
      m.input_tax.toFixed(2),
      m.net_tax.toFixed(2),
    ].join(","));
  }

  const csv = lines.join("\n");
  const isExcel = format === "excel" || format === "xls" || format === "xlsx";
  const filename = `axein-gst-report-${data.from}_to_${data.to}.${isExcel ? "xls" : "csv"}`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": isExcel ? "application/vnd.ms-excel" : "text/csv",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
