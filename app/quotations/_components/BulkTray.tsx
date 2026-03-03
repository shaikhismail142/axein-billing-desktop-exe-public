"use client";

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSelection } from "./selection";
import { downloadGeneratedFile } from "@/app/lib/download-client";

const ALLOW_DELETE = true;
const FILTER_KEYS_TO_KEEP = new Set(["q", "page", "perPage"]);

export default function BulkTray({ total }: { total: number }) {
  const { selectedIds, clear, allFiltered, setAllFiltered } = useSelection();
  const router = useRouter();
  const sp = useSearchParams();
  const [isDeleting, setIsDeleting] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);

  const csvHref = useMemo(() => {
    if (allFiltered) {
      const params = new URLSearchParams();
      for (const [k, v] of Array.from(sp.entries())) {
        if (FILTER_KEYS_TO_KEEP.has(k)) params.set(k, v);
      }
      params.delete("page");
      return `/api/quotations/export${params.size ? `?${params.toString()}` : ""}`;
    }
    if (selectedIds.length) {
      return `/api/quotations/export?ids=${selectedIds.join(",")}`;
    }
    return "";
  }, [allFiltered, selectedIds, sp]);

  const selectedCount = allFiltered ? total : selectedIds.length;
  const hasAny = selectedCount > 0;
  const deletingAllRecords = allFiltered || (total > 0 && selectedIds.length === total);
  const exportFileName = allFiltered ? "quotations_filtered.csv" : "quotations_selected.csv";

  const handleDownload = async () => {
    if (!csvHref || downloadBusy) return;
    setDownloadBusy(true);
    setDownloadMsg(null);
    const result = await downloadGeneratedFile(csvHref, exportFileName);
    if (!result.ok) {
      setDownloadMsg(result.error || "Export failed");
    } else {
      setDownloadMsg(`Quotation export ready: ${result.fileName || exportFileName}`);
    }
    setDownloadBusy(false);
    setTimeout(() => setDownloadMsg(null), 3500);
  };

  const handleDelete = async () => {
    if (!ALLOW_DELETE || !hasAny || isDeleting) return;
    const msg = deletingAllRecords
      ? `Warning: this will permanently delete ALL ${selectedCount} selected quotation(s). Continue?`
      : `Delete ${selectedIds.length} selected quotation(s)? This cannot be undone.`;
    if (!confirm(msg)) return;
    if (deletingAllRecords) {
      const finalConfirm = confirm(
        "Final confirmation: all selected quotation records will be permanently deleted."
      );
      if (!finalConfirm) return;
    }

    setIsDeleting(true);
    try {
      const payload = allFiltered
        ? {
            all: true,
            ...Object.fromEntries(
              Array.from(sp.entries()).filter(([k]) => FILTER_KEYS_TO_KEEP.has(k))
            ),
          }
        : { ids: selectedIds };

      const res = await fetch("/api/quotations/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res
        .json()
        .catch(async () => ({ error: await res.text().catch(() => "") }));
      if (!res.ok) {
        throw new Error(result?.error || result?.message || "Delete failed");
      }
      const deleted = Number(result?.deleted || 0);
      const blocked = Number(result?.blocked || 0);
      if (blocked > 0) {
        alert(
          result?.message ||
            `${deleted} quotation(s) deleted. ${blocked} could not be deleted due to linked records.`
        );
      }
      clear();
      setAllFiltered(false);
      router.refresh();
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error && err.message ? err.message : "Failed to delete quotations.";
      alert(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClear = () => {
    clear();
    setAllFiltered(false);
  };

  if (!hasAny) {
    return total > 0 ? (
      <div className="text-sm text-gray-600 mt-1">
        <button
          type="button"
          className="underline"
          onClick={() => setAllFiltered(true)}
          aria-label={`Select all ${total} filtered results`}
          title={`Select all ${total} filtered results`}
        >
          Select all {total} results
        </button>
      </div>
    ) : null;
  }

  return (
    <div className="sticky bottom-4 left-0 right-0 mx-auto max-w-5xl z-20">
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
              disabled={!csvHref || downloadBusy}
              aria-disabled={!csvHref || downloadBusy}
              onClick={handleDownload}
              title={allFiltered ? "Export ALL filtered quotations" : "Export selected quotations"}
            >
              {downloadBusy ? "Generating..." : allFiltered ? "Export ALL (CSV)" : "Export selected (CSV)"}
            </button>

            {ALLOW_DELETE && (
              <button
                type="button"
                className="px-3 py-2 rounded-xl border bg-red-600 text-white disabled:opacity-60"
                onClick={handleDelete}
                disabled={isDeleting}
                aria-busy={isDeleting}
                title={allFiltered ? "Delete ALL filtered quotations" : "Delete selected quotations"}
              >
                {isDeleting ? "Deleting…" : allFiltered ? "Delete ALL" : "Delete selected"}
              </button>
            )}

            <button
              type="button"
              className="px-3 py-2 rounded-xl border"
              onClick={handleClear}
              disabled={isDeleting}
              title="Clear selection"
            >
              Clear
            </button>
          </div>
        </div>
        {downloadMsg ? (
          <div className="muted" style={{ marginTop: 6, fontSize: 11, lineHeight: 1.2 }}>
            {downloadMsg}
          </div>
        ) : null}
      </div>
    </div>
  );
}
