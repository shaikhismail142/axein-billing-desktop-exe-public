#!/usr/bin/env node
/**
 * AxEin Staff Keygen CLI
 *
 * Commands:
 *   node tools/license-keygen/issue-license.js init
 *   node tools/license-keygen/issue-license.js issue --staff-pass <password>
 *   node tools/license-keygen/issue-license.js verify ./tools/license-keygen/licenses/AXEIN-XXXX.json
 *
 * Staff gate:
 *   Set AXEIN_STAFF_PASSWORD in the keygen environment.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";

const ROOT = process.cwd();
const TOOLS_DIR = path.join(ROOT, "tools", "license-keygen");
const PRIV = path.join(TOOLS_DIR, "ed25519-private.pem");
const INFO = path.join(TOOLS_DIR, "info.json");
const OUT_DIR = path.join(TOOLS_DIR, "licenses");

const BUSINESS_TYPES = [
  "clinic",
  "general_store",
  "spa_saloon",
  "hardware_store",
  "mobile_store",
  "hotel",
  "restaurant",
  "school_institute",
];

function ensureDirs() {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function rand4() {
  return Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, "0");
}

function genKey() {
  return `AXEIN-${rand4()}-${rand4()}-${rand4()}`;
}

function parseArgs() {
  const [, , cmd, ...rest] = process.argv;
  const args = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      const key = rest[i].slice(2);
      const val = rest[i + 1]?.startsWith("--") || rest[i + 1] == null ? true : rest[++i];
      args[key] = val;
    }
  }
  return { cmd, args };
}

function canonicalV1(payload) {
  return `${payload.license_key}\n${payload.email}\n${payload.expires_at}`;
}

function canonicalV2(payload) {
  const normalized = {
    v: 2,
    license_key: String(payload.license_key || ""),
    email: String(payload.email || ""),
    expires_at: String(payload.expires_at || ""),
    business_name: String(payload.business_name || ""),
    business_type: String(payload.business_type || ""),
    license_type: String(payload.license_type || ""),
    usage_mode: String(payload.usage_mode || ""),
    installation_scope: String(payload.installation_scope || ""),
    user_limit: Number(payload.user_limit || 0),
    computer_limit: Number(payload.computer_limit || 0),
    valid_from: String(payload.valid_from || ""),
    issued_at: String(payload.issued_at || ""),
    features: Array.isArray(payload.features)
      ? payload.features.map((x) => String(x)).sort()
      : [],
  };
  return JSON.stringify(normalized);
}

function canonicalV2Legacy(payload) {
  const normalized = {
    v: 2,
    license_key: String(payload.license_key || ""),
    email: String(payload.email || ""),
    expires_at: String(payload.expires_at || ""),
    business_name: String(payload.business_name || ""),
    business_type: String(payload.business_type || ""),
    license_type: String(payload.license_type || ""),
    usage_mode: String(payload.usage_mode || ""),
    installation_scope: String(payload.installation_scope || ""),
    user_limit: Number(payload.user_limit || 0),
    valid_from: String(payload.valid_from || ""),
    issued_at: String(payload.issued_at || ""),
    features: Array.isArray(payload.features)
      ? payload.features.map((x) => String(x)).sort()
      : [],
  };
  return JSON.stringify(normalized);
}

function signEd25519(privatePem, data) {
  const sig = crypto.sign(null, Buffer.from(data), crypto.createPrivateKey(privatePem));
  return sig.toString("base64");
}

function verifyWithCanonical(publicKey, data, signatureB64) {
  return crypto.verify(null, Buffer.from(data), publicKey, Buffer.from(signatureB64, "base64"));
}

function loadPublicKey() {
  const j = JSON.parse(fs.readFileSync(INFO, "utf8"));
  const spkiBase64 = j?.publicKeyBase64 || j?.public || j?.spki;
  if (!spkiBase64) throw new Error("info.json missing SPKI base64 (publicKeyBase64).");
  return crypto.createPublicKey({
    key: Buffer.from(spkiBase64, "base64"),
    format: "der",
    type: "spki",
  });
}

function toBase64Url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function promptInteractive(defaults = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q = (s) => new Promise((res) => rl.question(s, res));

  let license_key = await q(`License key [auto]: `);
  if (!license_key) license_key = genKey();

  let email = await q(`Customer email: `);
  while (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    email = await q(`  Please enter a valid email: `);
  }

  let business_name = await q(`Business name: `);
  while (!business_name.trim()) {
    business_name = await q(`  Business name is required: `);
  }

  let business_type = await q(`Business type (${BUSINESS_TYPES.join(", ")}) [general_store]: `);
  if (!business_type) business_type = "general_store";
  while (!BUSINESS_TYPES.includes(business_type)) {
    business_type = await q(`  Choose one of ${BUSINESS_TYPES.join(", ")}: `);
  }

  const usage_mode_input = await q(`Usage mode (standalone|lan_host) [standalone]: `);
  const usage_mode = usage_mode_input === "lan_host" ? "lan_host" : "standalone";
  const defaultComputerLimit = usage_mode === "lan_host" ? "3" : "1";

  let user_limit = await q(`Number of users/seats [5]: `);
  if (!user_limit) user_limit = "5";
  let computer_limit = await q(`Number of computers (host + LAN clients) [${defaultComputerLimit}]: `);
  if (!computer_limit) computer_limit = defaultComputerLimit;

  const license_type = (await q(`License type (basic|pro|enterprise) [basic]: `)) || "basic";

  const valid_from_raw = (await q(`Valid from (YYYY-MM-DD) [today]: `)) || "";
  const valid_from = /^\d{4}-\d{2}-\d{2}$/.test(valid_from_raw)
    ? `${valid_from_raw}T00:00:00.000Z`
    : new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";

  let period_months = await q(`Validity period in months [12]: `);
  if (!period_months) period_months = "12";

  const defaultScope = usage_mode === "lan_host" ? "business_lan" : "single_pc";
  const installation_scope =
    (await q(`Installation scope (single_pc|business_lan) [${defaultScope}]: `)) || defaultScope;

  const featuresRaw = await q(`Features (comma separated, optional): `);
  const features = featuresRaw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  rl.close();

  const start = new Date(valid_from);
  const months = Math.max(1, Number(period_months) || 12);
  const end = new Date(start);
  end.setMonth(end.getMonth() + months);

  return {
    v: 2,
    license_key,
    email,
    business_name: business_name.trim(),
    business_type,
    usage_mode,
    user_limit: Math.max(1, Number(user_limit) || 1),
    computer_limit: Math.max(1, Number(computer_limit) || 1),
    license_type: license_type.trim() || "basic",
    valid_from,
    expires_at: end.toISOString(),
    installation_scope: installation_scope.trim() || "single_pc",
    issued_at: new Date().toISOString(),
    features,
  };
}

async function assertStaffAuthorization(args) {
  const expected = String(process.env.AXEIN_STAFF_PASSWORD || "").trim();
  if (!expected) {
    throw new Error("AXEIN_STAFF_PASSWORD is not set. Set it before running issue command.");
  }

  let entered = String(args["staff-pass"] || "").trim();
  if (!entered) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    entered = await new Promise((res) => rl.question("Staff password: ", res));
    rl.close();
  }

  if (entered !== expected) {
    throw new Error("Staff authentication failed.");
  }
}

async function cmdInit() {
  ensureDirs();
  if (fs.existsSync(PRIV) && fs.existsSync(INFO)) {
    console.log("Keys already exist. Nothing to do.");
    return;
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicSpkiDer = publicKey.export({ type: "spki", format: "der" });

  fs.writeFileSync(PRIV, privatePem, { mode: 0o600 });
  fs.writeFileSync(
    INFO,
    JSON.stringify({ publicKeyBase64: Buffer.from(publicSpkiDer).toString("base64") }, null, 2)
  );

  console.log("Generated: ed25519-private.pem, info.json");
  console.log("Public key (SPKI base64) — set as LICENSE_PUBLIC_KEY env:");
  console.log(JSON.parse(fs.readFileSync(INFO, "utf8")).publicKeyBase64);
}

function payloadFromArgs(args) {
  if (!args.email) return null;

  const license_key = String(args.key || genKey());
  const business_name = String(args.business || "").trim();
  const business_type = String(args["business-type"] || "general_store").trim();
  const usage_mode = String(args["usage-mode"] || "standalone").trim();
  const user_limit = Math.max(1, Number(args.users || 1));
  const defaultComputerLimit = usage_mode === "lan_host" ? 3 : 1;
  const computer_limit = Math.max(1, Number(args.computers || defaultComputerLimit));
  const license_type = String(args["license-type"] || "basic").trim();
  const installation_scope = String(args.scope || (usage_mode === "lan_host" ? "business_lan" : "single_pc")).trim();
  const months = Math.max(1, Number(args.months || 12));
  const fromDate = String(args.from || "").trim();
  const valid_from = /^\d{4}-\d{2}-\d{2}$/.test(fromDate)
    ? `${fromDate}T00:00:00.000Z`
    : new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";

  const start = new Date(valid_from);
  const end = new Date(start);
  end.setMonth(end.getMonth() + months);

  const features = String(args.features || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  return {
    v: 2,
    license_key,
    email: String(args.email).trim(),
    business_name,
    business_type: BUSINESS_TYPES.includes(business_type) ? business_type : "general_store",
    usage_mode: usage_mode === "lan_host" ? "lan_host" : "standalone",
    user_limit,
    computer_limit,
    license_type,
    valid_from,
    expires_at: end.toISOString(),
    installation_scope,
    issued_at: new Date().toISOString(),
    features,
  };
}

async function cmdIssue(args) {
  ensureDirs();
  if (!fs.existsSync(PRIV)) throw new Error("Missing ed25519-private.pem. Run init first.");

  await assertStaffAuthorization(args);

  const payload = payloadFromArgs(args) || (await promptInteractive());
  const privPem = fs.readFileSync(PRIV, "utf8");

  const signature = signEd25519(privPem, canonicalV2(payload));
  const payloadB64u = toBase64Url(Buffer.from(JSON.stringify(payload)));
  const sigB64u = toBase64Url(Buffer.from(signature, "base64"));
  const packedToken = `L-${payload.license_key}.${payloadB64u}.${sigB64u}`;

  const out = {
    ...payload,
    signature,
    packed_token: packedToken,
  };

  const safeName = payload.license_key.replace(/[^A-Z0-9-]/gi, "_");
  const outJson = path.join(OUT_DIR, `${safeName}.json`);
  const outTxt = path.join(OUT_DIR, `${safeName}.txt`);

  fs.writeFileSync(outJson, JSON.stringify(out, null, 2));
  fs.writeFileSync(
    outTxt,
    [
      `license_key=${payload.license_key}`,
      `email=${payload.email}`,
      `business_name=${payload.business_name}`,
      `business_type=${payload.business_type}`,
      `license_type=${payload.license_type}`,
      `usage_mode=${payload.usage_mode}`,
      `user_limit=${payload.user_limit}`,
      `computer_limit=${payload.computer_limit}`,
      `valid_from=${payload.valid_from}`,
      `expires_at=${payload.expires_at}`,
      `installation_scope=${payload.installation_scope}`,
      `features=${payload.features.join(",")}`,
      `signature=${signature}`,
      `packed_token=${packedToken}`,
    ].join("\n")
  );

  console.log("Issued license:");
  console.log(out);
  console.log(`Saved:\n  ${outJson}\n  ${outTxt}`);
  console.log("\nActivate with packed token:");
  console.log(
    `curl -X POST http://localhost:3000/api/license/verify-key -H \"Content-Type: application/json\" -d '${JSON.stringify(
      { token: packedToken }
    )}'`
  );
}

async function cmdVerify(args) {
  const target = args.file || args.f || process.argv[3];
  if (!target) {
    console.error("Usage: issue-license.js verify ./tools/license-keygen/licenses/KEY.json");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(target, "utf8"));
  const signature = String(data.signature || "");
  const payload = { ...data };
  delete payload.signature;
  delete payload.packed_token;

  const pub = loadPublicKey();
  const okV2 = verifyWithCanonical(pub, canonicalV2(payload), signature);
  const okV2Legacy = verifyWithCanonical(pub, canonicalV2Legacy(payload), signature);
  const okV1 = verifyWithCanonical(pub, canonicalV1(payload), signature);

  console.log(okV2 || okV2Legacy || okV1 ? "Signature OK" : "Signature INVALID");
  console.log(`Mode: ${okV2 ? "v2" : okV2Legacy ? "v2-legacy" : okV1 ? "v1" : "invalid"}`);
}

(async function main() {
  const { cmd, args } = parseArgs();
  try {
    if (cmd === "init") return await cmdInit();
    if (cmd === "issue") return await cmdIssue(args);
    if (cmd === "verify") return await cmdVerify(args);

    console.log(`Usage:
  node tools/license-keygen/issue-license.js init
  node tools/license-keygen/issue-license.js issue --staff-pass <password>
  node tools/license-keygen/issue-license.js verify ./tools/license-keygen/licenses/AXEIN-ABCD.json

Environment:
  AXEIN_STAFF_PASSWORD=<staff-password>
`);
  } catch (e) {
    console.error("Error:", e?.message || e);
    process.exit(1);
  }
})();
