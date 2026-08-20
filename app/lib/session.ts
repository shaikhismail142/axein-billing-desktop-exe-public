import crypto from "node:crypto";
import { isSaasDeployment } from "@/app/lib/deployment";

export const SESSION_COOKIE_NAME = "axein_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const DEFAULT_SESSION_SECRET = "AxEinDesktopSessionSecret@2026#ChangeMe";

export type SessionClaims = {
  user_id: number;
  business_id: number;
  email: string;
  full_name: string;
  role_codes: string[];
  iat: number;
  exp: number;
};

function getSessionSecret() {
  const secret = (
    process.env.AXEIN_SESSION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    DEFAULT_SESSION_SECRET
  );
  if (isSaasDeployment() && secret === DEFAULT_SESSION_SECRET) {
    throw new Error("AXEIN_SESSION_SECRET is required in SaaS mode");
  }
  return secret;
}

function toBase64Url(input: Buffer | string) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, "base64");
}

function signData(data: string) {
  return toBase64Url(crypto.createHmac("sha256", getSessionSecret()).update(data).digest());
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function createSessionToken(input: Omit<SessionClaims, "iat" | "exp">) {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionClaims = {
    ...input,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const sig = signData(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string): SessionClaims | null {
  if (!token || typeof token !== "string") return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  const expected = signData(payloadB64);
  if (!safeEqual(sig, expected)) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(payloadB64).toString("utf8")) as SessionClaims;
    if (!parsed || typeof parsed !== "object") return null;
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(parsed.exp) || parsed.exp <= now) return null;
    if (!Number.isFinite(parsed.user_id) || parsed.user_id <= 0) return null;
    if (!Number.isFinite(parsed.business_id) || parsed.business_id <= 0) return null;
    if (!Array.isArray(parsed.role_codes)) parsed.role_codes = [];
    return parsed;
  } catch {
    return null;
  }
}

export function getCookieValue(cookieHeader: string | null | undefined, key: string) {
  const raw = String(cookieHeader || "");
  if (!raw) return "";
  const parts = raw.split(";").map((p) => p.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    if (k !== key) continue;
    return decodeURIComponent(part.slice(idx + 1));
  }
  return "";
}

export function readSessionFromRequest(req: Request) {
  const token = getCookieValue(req.headers.get("cookie"), SESSION_COOKIE_NAME);
  return verifySessionToken(token);
}

export function makeSessionCookie(token: string) {
  // Session cookie: requires login again after app/browser closes.
  const secure = isSaasDeployment() ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function makeClearedSessionCookie() {
  const secure = isSaasDeployment() ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}
