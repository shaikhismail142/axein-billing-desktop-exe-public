#!/usr/bin/env node
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

const standaloneSrc = path.join(root, ".next", "standalone");
const staticSrc = path.join(root, ".next", "static");
const serverChunksMediaSrc = path.join(root, ".next", "server", "chunks", "static", "media");
const publicSrc = path.join(root, "public");
const migrationsSrc = path.join(root, "db", "migrations");
const pgliteDistSrc = path.join(root, "node_modules", "@electric-sql", "pglite", "dist");
const keygenPrivateKeySrc = path.join(root, "tools", "license-keygen", "ed25519-private.pem");

const runtimeRoot = path.join(root, "desktop", "runtime");
const appRoot = path.join(runtimeRoot, "app");
const standaloneDst = path.join(appRoot, "standalone");
const staticDst = path.join(standaloneDst, ".next", "static");
const serverChunksMediaDst = path.join(standaloneDst, ".next", "server", "chunks", "static", "media");
const publicDst = path.join(standaloneDst, "public");
const migrationsDst = path.join(standaloneDst, "db", "migrations");
const pgliteDistDst = path.join(standaloneDst, "vendor", "pglite", "dist");
const pglitePkgDst = path.join(standaloneDst, "vendor", "pglite", "package.json");
const keygenPrivateKeyDst = path.join(standaloneDst, "vendor", "keygen", "ed25519-private.pem");

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dst) {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.cp(src, dst, { recursive: true, force: true });
}

function decodePemFromEnv() {
  const rawPem = (process.env.AXEIN_KEYGEN_PRIVATE_KEY_PEM || "").trim();
  if (rawPem) return rawPem;

  const b64 = (process.env.AXEIN_KEYGEN_PRIVATE_KEY_PEM_B64 || "").trim();
  if (!b64) return "";
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

async function main() {
  if (!(await exists(standaloneSrc))) {
    throw new Error("Missing .next/standalone. Run desktop web build first.");
  }

  await fs.rm(appRoot, { recursive: true, force: true });
  await fs.mkdir(appRoot, { recursive: true });

  await copyDir(standaloneSrc, standaloneDst);

  if (await exists(staticSrc)) {
    await copyDir(staticSrc, staticDst);
  }

  if (await exists(serverChunksMediaSrc)) {
    await copyDir(serverChunksMediaSrc, serverChunksMediaDst);
  }

  if (await exists(publicSrc)) {
    await copyDir(publicSrc, publicDst);
  }

  if (await exists(migrationsSrc)) {
    await copyDir(migrationsSrc, migrationsDst);
  }

  if (await exists(pgliteDistSrc)) {
    await copyDir(pgliteDistSrc, pgliteDistDst);
    await fs.writeFile(
      pglitePkgDst,
      JSON.stringify(
        {
          name: "@axein/pglite-runtime",
          private: true,
          type: "module",
        },
        null,
        2
      ),
      "utf8"
    );
  }

  if (process.env.AXEIN_INCLUDE_KEYGEN_PRIVATE === "1") {
    const pemFromEnv = decodePemFromEnv();
    if (pemFromEnv) {
      if (!pemFromEnv.includes("BEGIN PRIVATE KEY")) {
        throw new Error("Invalid AXEIN_KEYGEN_PRIVATE_KEY_PEM(_B64): expected PEM private key contents.");
      }
      await fs.mkdir(path.dirname(keygenPrivateKeyDst), { recursive: true });
      await fs.writeFile(keygenPrivateKeyDst, pemFromEnv, { encoding: "utf8", mode: 0o600 });
    } else if (await exists(keygenPrivateKeySrc)) {
      await fs.mkdir(path.dirname(keygenPrivateKeyDst), { recursive: true });
      await fs.copyFile(keygenPrivateKeySrc, keygenPrivateKeyDst);
    }
  }

  const readme = [
    "This folder is generated for AxEin desktop runtime.",
    "Do not edit manually.",
    "",
    `Generated at: ${new Date().toISOString()}`,
  ].join("\n");

  await fs.writeFile(path.join(appRoot, "README.txt"), readme, "utf8");

  // Copy production package metadata for debugging/support.
  const pkgPath = path.join(root, "package.json");
  if (fssync.existsSync(pkgPath)) {
    await fs.copyFile(pkgPath, path.join(appRoot, "package.json"));
  }

  console.log("Desktop runtime prepared at:", appRoot);
}

main().catch((err) => {
  console.error("prepare-runtime failed:", err.message || err);
  process.exit(1);
});
