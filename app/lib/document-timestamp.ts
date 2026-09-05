export const INDIA_TIME_ZONE = "Asia/Kolkata";

function toDate(value?: string | Date | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDocumentDate(value?: string | Date | null): string {
  const date = toDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

// The database stores TIMESTAMPTZ in UTC; display the same instant in IST with milliseconds.
export function formatIssuedAtIST(value?: string | Date | null): string {
  const date = toDate(value);
  if (!date) return "-";
  const formatted = new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
  return `${formatted}.${String(date.getMilliseconds()).padStart(3, "0")} IST`;
}
