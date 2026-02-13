import crypto from "node:crypto";
import { getCookieValue } from "@/app/lib/session";

export const KEYGEN_UNLOCK_COOKIE_NAME = "axein_keygen_unlock";
const KEYGEN_UNLOCK_TTL_SECONDS = 60 * 30;
const DEFAULT_KEYGEN_SESSION_SECRET = "AxEinKeygenSessionSecret@2026#ChangeMe";

type KeygenUnlockClaims = {
  scope: "keygen_unlock";
  iat: number;
  exp: number;
};

function getKeygenSessionSecret() {
  return (
    process.env.AXEIN_KEYGEN_SESSION_SECRET ||
    process.env.AXEIN_SESSION_SECRET ||
    DEFAULT_KEYGEN_SESSION_SECRET
  );
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
  return toBase64Url(
    crypto.createHmac("sha256", getKeygenSessionSecret()).update(data).digest()
  );
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function createKeygenUnlockToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload: KeygenUnlockClaims = {
    scope: "keygen_unlock",
    iat: now,
    exp: now + KEYGEN_UNLOCK_TTL_SECONDS,
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const sig = signData(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyKeygenUnlockToken(token: string) {
  if (!token || typeof token !== "string") return false;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return false;
  const expected = signData(payloadB64);
  if (!safeEqual(sig, expected)) return false;
  try {
    const parsed = JSON.parse(fromBase64Url(payloadB64).toString("utf8")) as KeygenUnlockClaims;
    if (!parsed || parsed.scope !== "keygen_unlock") return false;
    const now = Math.floor(Date.now() / 1000);
    return Number.isFinite(parsed.exp) && parsed.exp > now;
  } catch {
    return false;
  }
}

export function isKeygenUnlocked(req: Request) {
  const token = getCookieValue(req.headers.get("cookie"), KEYGEN_UNLOCK_COOKIE_NAME);
  return verifyKeygenUnlockToken(token);
}

export function makeKeygenUnlockCookie(token: string) {
  return `${KEYGEN_UNLOCK_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${KEYGEN_UNLOCK_TTL_SECONDS}; HttpOnly; SameSite=Lax`;
}

export function makeClearedKeygenUnlockCookie() {
  return `${KEYGEN_UNLOCK_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
