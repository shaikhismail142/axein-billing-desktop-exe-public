"use client";

import { useState } from "react";
import { downloadGeneratedFile } from "@/app/lib/download-client";

type Props = {
  url: string;
  fileName: string;
  label: string;
  className?: string;
  busyLabel?: string;
  successPrefix?: string;
};

export default function DownloadButton({
  url,
  fileName,
  label,
  className,
  busyLabel = "Generating...",
  successPrefix = "Generated file",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onDownload() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const result = await downloadGeneratedFile(url, fileName);
    if (!result.ok) {
      setMsg(result.error || "Download failed");
    } else {
      setMsg(`${successPrefix}: ${result.fileName || fileName}`);
    }
    setBusy(false);
    setTimeout(() => setMsg(null), 3500);
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <button type="button" className={className || "btn"} onClick={onDownload} disabled={busy}>
        {busy ? busyLabel : label}
      </button>
      {msg ? (
        <span className="muted" style={{ fontSize: 11, lineHeight: 1.2 }}>
          {msg}
        </span>
      ) : null}
    </span>
  );
}
