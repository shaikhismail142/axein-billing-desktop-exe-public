"use client";

import { useEffect, useState } from "react";

type LogRow = {
  id: number;
  created_at: string;
  level: string;
  source: string | null;
  event_code: string | null;
  message: string;
};

export default function ProfileLogsPage() {
  const [items, setItems] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<string>("");

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const qp = new URLSearchParams({ limit: "300" });
      if (level) qp.set("level", level);
      const res = await fetch(`/api/logs?${qp.toString()}`, { cache: "no-store", headers: { "x-admin": "1" } });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed to load logs");
      setItems(Array.isArray(j?.items) ? j.items : []);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load logs"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, [level]);

  async function downloadWithAdmin(url: string, fallbackName: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { headers: { "x-admin": "1" } });
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
        <h1 style={{ margin: 0 }}>Diagnostics Logs</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Use this section to inspect failures and export logs for AxEin support.
        </p>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label className="muted">Filter Level</label>
          <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">All</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
          <button className="btn" onClick={load} disabled={busy}>{busy ? "Refreshing..." : "Refresh"}</button>
          <button
            className="btn"
            onClick={() =>
              downloadWithAdmin(
                `/api/logs?format=ndjson${level ? `&level=${encodeURIComponent(level)}` : ""}`,
                `axein-logs-${Date.now()}.ndjson`
              )
            }
            disabled={busy}
          >
            Download Logs
          </button>
          <button
            className="btn"
            onClick={() => downloadWithAdmin("/api/logs/support-bundle", `axein-support-bundle-${Date.now()}.json`)}
            disabled={busy}
          >
            Download Support Bundle
          </button>
        </div>

        {error ? <div style={{ color: "var(--danger)", marginTop: 10 }}>{error}</div> : null}

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 180 }}>Time</th>
                <th style={{ width: 80 }}>Level</th>
                <th style={{ width: 120 }}>Source</th>
                <th style={{ width: 140 }}>Event</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>{row.level}</td>
                  <td>{row.source || "-"}</td>
                  <td>{row.event_code || "-"}</td>
                  <td>{row.message}</td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">No logs found for current filter.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
