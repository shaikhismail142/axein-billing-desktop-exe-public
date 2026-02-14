"use client";

import { useCallback, useEffect, useState } from "react";

type AuditRow = {
  id: number;
  created_at: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_user_id: number | null;
  actor_name: string | null;
  actor_email: string | null;
  meta_json: any;
};

export default function ProfileLogsPage() {
  const [items, setItems] = useState<AuditRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState<string>("");
  const [entityType, setEntityType] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(100);
  const [total, setTotal] = useState<number>(0);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const qp = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (q.trim()) qp.set("q", q.trim());
      if (entityType.trim()) qp.set("entity_type", entityType.trim());
      const res = await fetch(`/api/audit-logs?${qp.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed to load logs");
      setItems(Array.isArray(j?.items) ? j.items : []);
      setTotal(Number.isFinite(Number(j?.total)) ? Number(j.total) : 0);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load logs"));
    } finally {
      setBusy(false);
    }
  }, [q, entityType, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // Reset pagination when filters change.
    setPage(1);
  }, [q, entityType]);

  async function download(url: string, fallbackName: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || "Download failed");
      }

      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="?([^"]+)"?/i);
      const name = m?.[1] || fallbackName;
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e: any) {
      setError(String(e?.message || "Download failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ padding: 16 }}>
        <h1 style={{ margin: 0 }}>Audit Logs</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Review activity history (user changes, access updates, licensing, LAN) and export data for AxEin support.
        </p>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label className="muted">Search</label>
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="action, entity, id…"
            style={{ minWidth: 240 }}
          />
          <label className="muted">Entity</label>
          <input
            className="input"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="sale, user, role…"
            style={{ width: 160 }}
          />
          <label className="muted">Page size</label>
          <select
            className="input"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) || 100)}
            style={{ width: 120 }}
          >
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
          <button className="btn" onClick={load} disabled={busy}>{busy ? "Refreshing..." : "Refresh"}</button>
          <button
            className="btn"
            onClick={() =>
              download(
                `/api/audit-logs?format=ndjson${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}${entityType.trim() ? `&entity_type=${encodeURIComponent(entityType.trim())}` : ""}`,
                `axein-audit-logs-${Date.now()}.ndjson`
              )
            }
            disabled={busy}
          >
            Download Audit Logs
          </button>
          <button
            className="btn"
            onClick={() => download("/api/logs/support-bundle", `axein-support-bundle-${Date.now()}.json`)}
            disabled={busy}
          >
            Download Support Bundle
          </button>
          <button
            className="btn"
            onClick={() => download(`/api/logs?format=ndjson`, `axein-app-logs-${Date.now()}.ndjson`)}
            disabled={busy}
            title="Low-level runtime/app logs (usually empty unless errors are reported)"
          >
            Download App Logs
          </button>
        </div>

        {error ? <div style={{ color: "var(--danger)", marginTop: 10 }}>{error}</div> : null}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <div className="muted" style={{ fontSize: 12 }}>
            {total > 0 ? `Showing page ${page} • ${total.toLocaleString()} total` : `Showing page ${page}`}
          </div>
          <button className="btn" disabled={busy || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Prev
          </button>
          <button
            className="btn"
            disabled={busy || (total > 0 && page * pageSize >= total)}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 180 }}>Time</th>
                <th style={{ width: 180 }}>Actor</th>
                <th style={{ width: 200 }}>Action</th>
                <th style={{ width: 160 }}>Entity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>
                    {row.actor_name || row.actor_email
                      ? `${row.actor_name || ""}${row.actor_email ? ` (${row.actor_email})` : ""}`
                      : row.actor_user_id
                      ? `User #${row.actor_user_id}`
                      : "—"}
                  </td>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
                    {row.action}
                  </td>
                  <td>
                    <span className="muted">{row.entity_type || "—"}</span>
                    {row.entity_id ? <span className="muted"> • {row.entity_id}</span> : null}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {(() => {
                      try {
                        const txt = row.meta_json ? JSON.stringify(row.meta_json) : "";
                        return txt.length > 220 ? txt.slice(0, 220) + "…" : txt || "—";
                      } catch {
                        return "—";
                      }
                    })()}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">No audit logs found for current filter.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
