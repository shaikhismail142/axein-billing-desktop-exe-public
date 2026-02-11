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
const publicSrc = path.join(root, "public");

const runtimeRoot = path.join(root, "desktop", "runtime");
const appRoot = path.join(runtimeRoot, "app");
const standaloneDst = path.join(appRoot, "standalone");
const staticDst = path.join(standaloneDst, ".next", "static");
const publicDst = path.join(standaloneDst, "public");

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

  if (await exists(publicSrc)) {
    await copyDir(publicSrc, publicDst);
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
