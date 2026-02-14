import { headers } from "next/headers";

export type ServerRequestContext = {
  baseUrl: string;
  authHeaders: Record<string, string>;
};

function runtimeFallbackBaseUrl(): string {
  const port =
    process.env.AXEIN_RUNTIME_PORT ||
    process.env.PORT ||
    // Local desktop default.
    "3199";
  return `http://127.0.0.1:${port}`;
}

export function getServerRequestContext(): ServerRequestContext {
  const h = headers();

  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";

  const baseUrl = host ? `${proto}://${host}` : runtimeFallbackBaseUrl();

  const cookie = h.get("cookie");
  const authHeaders: Record<string, string> = {};
  if (cookie) authHeaders.cookie = cookie;

  return { baseUrl, authHeaders };
}

