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

  const hasAny = allFiltered || selectedIds.length > 0;

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
    const prompt = allFiltered
      ? `Delete ALL ${total} filtered products?`
      : `Delete ${selectedIds.length} selected product(s)?`;
    if (!confirm(prompt)) return;

    const payload = allFiltered
      ? {
          all: true,
          ...Object.fromEntries(
            Array.from(sp.entries()).filter(([k, v]) => FILTER_KEYS_TO_KEEP.has(k) && !!v)
          ),
        }
      : { ids: selectedIds };

    const res = await fetch("/api/products/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      alert(msg || `Delete failed (${res.status})`);
      return;
    }
    clear();
    router.refresh();
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
              disabled={downloadBusy}
            >
              {downloadBusy ? "Generating..." : allFiltered ? "Export ALL" : "Export selected"}
            </button>
            <button className="px-3 py-2 rounded-xl border bg-red-600 text-white" onClick={handleDelete}>
              {allFiltered ? "Delete ALL" : "Delete selected"}
            </button>
            <button className="px-3 py-2 rounded-xl border" onClick={() => clear()}>
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
