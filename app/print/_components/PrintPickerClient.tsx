"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type TabKey = "a4" | "thermal";

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

export default function PrintPickerClient(props: Props) {
  const [tab, setTab] = useState<TabKey>("a4");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const iframeSrc = tab === "a4" ? props.a4IframeSrc : props.thermalIframeSrc;
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
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          {tab === "a4"
            ? "A4 layout for standard printers and PDF."
            : "Thermal receipt layout for 80mm / 58mm printers."}
        </div>

        <div
          style={{
            border: "1px solid var(--glass-brd)",
            borderRadius: 12,
            overflow: "hidden",
            background: "var(--surface-1)",
          }}
        >
          <iframe
            title={iframeTitle}
            src={iframeSrc}
            style={{
              width: "100%",
              height: tab === "thermal" ? 860 : 980,
              border: 0,
              background: "#fff",
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

