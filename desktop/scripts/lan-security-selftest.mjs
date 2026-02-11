#!/usr/bin/env node
import crypto from "node:crypto";

function hashWithSecret(value, secret) {
  return crypto.createHash("sha256").update(`${value}::${secret}`).digest("hex");
}

function safeEqHex(a, b) {
  const aa = Buffer.from(String(a || ""), "hex");
  const bb = Buffer.from(String(b || ""), "hex");
  if (aa.length === 0 || bb.length === 0 || aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

(function main() {
  const secret = "test-secret-1";
  const token = "TOKEN-ABC-123";
  const hash = hashWithSecret(token, secret);

  assert(hash.length === 64, "sha256 digest should be 64 hex chars");
  assert(safeEqHex(hash, hashWithSecret(token, secret)), "equal hashes should match");
  assert(!safeEqHex(hash, hashWithSecret("WRONG", secret)), "different value must not match");
  assert(!safeEqHex(hash, hashWithSecret(token, "other-secret")), "different secret must not match");

  console.log("LAN security self-test passed.");
})();
