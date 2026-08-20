import { readSessionFromRequest } from "@/app/lib/session";
import { isSaasDeployment } from "@/app/lib/deployment";

export function parsePositiveInt(input: string | null | undefined, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function getRequestBusinessId(req: Request, fallback = 1): number {
  const session = readSessionFromRequest(req);
  if (isSaasDeployment()) return session?.business_id || fallback;
  const headers = req.headers;
  const hdr = headers.get("x-business-id");
  if (hdr) return parsePositiveInt(hdr, fallback);

  const url = new URL(req.url);
  const fromQuery = parsePositiveInt(url.searchParams.get("business_id"), 0);
  if (fromQuery > 0) return fromQuery;

  if (session?.business_id && session.business_id > 0) return session.business_id;
  return fallback;
}

export function getRequestUserId(req: Request, fallback = 1): number {
  const session = readSessionFromRequest(req);
  if (isSaasDeployment()) return session?.user_id || fallback;
  const headers = req.headers;
  const hdr = headers.get("x-user-id");
  if (hdr) return parsePositiveInt(hdr, fallback);

  const url = new URL(req.url);
  const fromQuery = parsePositiveInt(url.searchParams.get("user_id"), 0);
  if (fromQuery > 0) return fromQuery;

  if (session?.user_id && session.user_id > 0) return session.user_id;
  return fallback;
}
