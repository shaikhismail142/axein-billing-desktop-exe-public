"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

type TabKey = "a4" | "thermal";
type ThermalPaper = 80 | 58;

type Props = {
  title: string;
  subtitle?: string | null;
  backHref: string;
  backLabel: string;
  a4IframeSrc: string;
  thermalIframeSrc: string;
  pdfDownloadSrc?: string | null;
  pdfFallbackName?: string | null;
};

function parseFilenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const m = cd.match(/filename\\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i);
  const raw = (m?.[1] || m?.[2] || "").trim();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function withSearchParam(inputUrl: string, key: string, value: string): string {
  try {
    const u = new URL(inputUrl, window.location.origin);
    u.searchParams.set(key, value);
    return u.pathname + (u.search ? u.search : "") + (u.hash || "");
  } catch {
    // Fallback: naive append.
    const hasQuery = inputUrl.includes("?");
    const join = hasQuery ? "&" : "?";
    return `${inputUrl}${join}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

export default function PrintPickerClient(props: Props) {
  const [tab, setTab] = useState<TabKey>("a4");
  const [thermalPaper, setThermalPaper] = useState<ThermalPaper>(80);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const thermalSrc = useMemo(() => {
    return withSearchParam(props.thermalIframeSrc, "paper", String(thermalPaper));
  }, [props.thermalIframeSrc, thermalPaper]);

  const iframeSrc = tab === "a4" ? props.a4IframeSrc : thermalSrc;
  const iframeTitle = tab === "a4" ? "A4 Preview" : "Thermal Preview";

  const pdfName = useMemo(() => {
    if (props.pdfFallbackName) return props.pdfFallbackName;
    return `axein-${Date.now()}.pdf`;
  }, [props.pdfFallbackName]);

  async function downloadPdf() {
    if (!props.pdfDownloadSrc) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(props.pdfDownloadSrc, { cache: "no-store" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || "Download failed");
      }
      const blob = await res.blob();
      const fromHeader = parseFilenameFromContentDisposition(res.headers.get("Content-Disposition"));
      const name = fromHeader || pdfName;
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

  function printPreview() {
    setError(null);
    try {
      const win = iframeRef.current?.contentWindow;
      if (!win) throw new Error("Preview not ready");
      win.focus();
      win.print();
    } catch (e: any) {
      setError(String(e?.message || "Unable to open print dialog"));
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0 }}>{props.title}</h1>
            {props.subtitle ? (
              <p className="muted" style={{ marginTop: 8 }}>
                {props.subtitle}
              </p>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className={tab === "a4" ? "btn-primary" : "btn"} onClick={() => setTab("a4")} disabled={busy}>
              A4 Preview
            </button>
            <button className={tab === "thermal" ? "btn-primary" : "btn"} onClick={() => setTab("thermal")} disabled={busy}>
              Thermal Preview
            </button>
            <button className="btn" onClick={printPreview} disabled={busy}>
              Print / Save
            </button>
            {props.pdfDownloadSrc ? (
              <button className="btn" onClick={downloadPdf} disabled={busy}>
                {busy ? "Downloading..." : "Download PDF"}
              </button>
            ) : null}
          </div>
        </div>

        {error ? <div style={{ color: "var(--danger)", marginTop: 10 }}>{error}</div> : null}
      </div>

      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {tab === "a4"
            ? "A4 layout for standard printers and PDF."
            : "Thermal receipt layout for 80mm / 58mm printers."}
          {tab === "thermal" ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className="muted">Paper</span>
              <select
                className="input"
                style={{ padding: "6px 10px", borderRadius: 10 }}
                value={thermalPaper}
                onChange={(e) => setThermalPaper((Number(e.target.value) === 58 ? 58 : 80) as ThermalPaper)}
                disabled={busy}
                title="Choose your thermal printer paper width"
              >
                <option value={80}>80mm</option>
                <option value={58}>58mm</option>
              </select>
            </span>
          ) : null}
        </div>

        <div
          style={{
            border: "1px solid var(--glass-brd)",
            borderRadius: 12,
            overflow: "hidden",
            background: "var(--surface-1)",
            display: "flex",
            justifyContent: "center",
            padding: tab === "thermal" ? 14 : 0,
          }}
        >
          <iframe
            title={iframeTitle}
            src={iframeSrc}
            ref={iframeRef}
            key={iframeSrc}
            style={{
              width: tab === "thermal" ? "min(420px, 100%)" : "100%",
              height: tab === "thermal" ? 860 : 980,
              border: 0,
              background: "#fff",
              borderRadius: tab === "thermal" ? 10 : 0,
            }}
          />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Link className="glass-btn" href={props.backHref}>
          ← {props.backLabel}
        </Link>
      </div>
    </div>
  );
}
