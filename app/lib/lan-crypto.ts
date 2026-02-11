import crypto from "node:crypto";

function toBase36(input: Buffer) {
  return input.toString("hex").toUpperCase();
}

export function randomId(prefix: string) {
  return `${prefix}-${toBase36(crypto.randomBytes(8))}`;
}

export function randomToken(bytes = 24) {
  return toBase36(crypto.randomBytes(bytes));
}

export function randomPairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[raw[i] % alphabet.length];
  }
  return out;
}

export function hashWithSecret(value: string, secret: string) {
  return crypto.createHash("sha256").update(`${value}::${secret}`).digest("hex");
}

export function safeEqHex(a: string, b: string) {
  const aa = Buffer.from(String(a || ""), "hex");
  const bb = Buffer.from(String(b || ""), "hex");
  if (aa.length === 0 || bb.length === 0 || aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(new Uint8Array(aa), new Uint8Array(bb));
}
