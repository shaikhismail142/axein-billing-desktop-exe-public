"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useSelection } from "./selection";
import { downloadGeneratedFile } from "@/app/lib/download-client";

const FILTER_KEYS_TO_KEEP = new Set(["q", "category", "low"]);

export default function BulkTray({ total }: { total: number }) {
  const { selectedIds, clear, allFiltered, setAllFiltered } = useSelection();
  const router = useRouter();
  const sp = useSearchParams();
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const hasAny = allFiltered || selectedIds.length > 0;
  const selectedCount = allFiltered ? total : selectedIds.length;
  const deletingAllRecords = allFiltered || (total > 0 && selectedIds.length === total);

  // When nothing is selected, show the "Select all" hint
  if (!hasAny) {
    return total > 0 ? (
      <div className="text-sm text-gray-600 mt-1">
        <button className="underline" onClick={() => setAllFiltered(true)}>
          Select all {total} results
        </button>
      </div>
    ) : null;
  }

  const exportHref = (() => {
    if (allFiltered) {
      const params = new URLSearchParams();
      for (const [k, v] of Array.from(sp.entries())) {
        if (FILTER_KEYS_TO_KEEP.has(k) && v) params.set(k, v);
      }
      return `/api/products/export${params.size ? `?${params.toString()}` : ""}`;
    }
    return `/api/products/export?ids=${selectedIds.join(",")}`;
  })();

  const exportFileName = allFiltered ? "products_filtered.csv" : "products_selected.csv";

  const handleDownload = async () => {
    if (!exportHref || downloadBusy) return;
    setDownloadBusy(true);
    setDownloadMsg(null);
    const result = await downloadGeneratedFile(exportHref, exportFileName);
    if (!result.ok) {
      setDownloadMsg(result.error || "Export failed");
    } else {
      setDownloadMsg(`Product export ready: ${result.fileName || exportFileName}`);
    }
    setDownloadBusy(false);
    setTimeout(() => setDownloadMsg(null), 3500);
  };

  const handleDelete = async () => {
    if (isDeleting || !hasAny) return;

    const promptText = deletingAllRecords
      ? `Warning: this will permanently delete ALL ${selectedCount} selected product record(s). Continue?`
      : `Delete ${selectedCount} selected product(s)?`;
    if (!confirm(promptText)) return;
    if (deletingAllRecords) {
      const finalConfirm = confirm(
        "Final confirmation: all selected product records will be permanently deleted."
      );
      if (!finalConfirm) return;
    }

    setIsDeleting(true);

    const payload = allFiltered
      ? {
          all: true,
          ...Object.fromEntries(
            Array.from(sp.entries()).filter(([k, v]) => FILTER_KEYS_TO_KEEP.has(k) && !!v)
          ),
        }
      : { ids: selectedIds };

    try {
      const res = await fetch("/api/products/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(async () => ({ error: await res.text().catch(() => "") }));
      if (!res.ok) {
        alert(result?.error || result?.message || `Delete failed (${res.status})`);
        return;
      }

      const deleted = Number(result?.deleted || 0);
      const blocked = Number(result?.blocked || 0);
      if (blocked > 0) {
        alert(
          result?.message ||
            `${deleted} product(s) deleted. ${blocked} could not be deleted because they are linked to invoices/purchases/inventory history.`
        );
      }

      clear();
      setAllFiltered(false);
      router.refresh();
    } catch (e: any) {
      alert(String(e?.message || "Delete failed"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="sticky bottom-4 left-0 right-0 mx-auto max-w-6xl">
      <div className="rounded-2xl border p-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            {allFiltered
              ? `All ${total} filtered results selected`
              : `${selectedIds.length} selected`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-xl border disabled:opacity-60"
              onClick={handleDownload}
              disabled={downloadBusy || isDeleting}
            >
              {downloadBusy ? "Generating..." : allFiltered ? "Export ALL" : "Export selected"}
            </button>
            <button
              className="px-3 py-2 rounded-xl border bg-red-600 text-white disabled:opacity-60"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {allFiltered ? "Delete ALL" : "Delete selected"}
            </button>
            <button
              className="px-3 py-2 rounded-xl border"
              onClick={() => {
                clear();
                setAllFiltered(false);
              }}
              disabled={isDeleting}
            >
              Clear
            </button>
          </div>
        </div>
        {downloadMsg ? (
          <div className="text-xs text-gray-600 mt-2">{downloadMsg}</div>
        ) : null}
      </div>
    </div>
  );
}
