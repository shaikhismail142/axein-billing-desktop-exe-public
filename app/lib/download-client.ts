"use client";

function parseFilenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const m = cd.match(/filename\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i);
  const raw = (m?.[1] || m?.[2] || "").trim();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function downloadGeneratedFile(
  url: string,
  fallbackName: string
): Promise<{ ok: boolean; fileName?: string; error?: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: text || `Download failed (${res.status})` };
    }

    const blob = await res.blob();
    const fromHeader = parseFilenameFromContentDisposition(res.headers.get("Content-Disposition"));
    const fileName = fromHeader || fallbackName;

    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(href);

    return { ok: true, fileName };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || "Download failed") };
  }
}
