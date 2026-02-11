#!/usr/bin/env node
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const bundleDir = path.join(root, "desktop", "src-tauri", "target", "release", "bundle", "nsis");
const releaseDir = path.join(root, "desktop", "release");

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fssync.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function main() {
  await fs.mkdir(releaseDir, { recursive: true });

  let files = [];
  try {
    const entries = await fs.readdir(bundleDir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".exe"))
      .map((e) => path.join(bundleDir, e.name));
  } catch {
    // no installer folder yet
  }

  if (files.length === 0) {
    throw new Error("No NSIS installer .exe found. Run desktop build first.");
  }

  const lines = [];
  for (const file of files) {
    const digest = await sha256(file);
    lines.push(`${digest}  ${path.basename(file)}`);
  }

  const output = lines.join("\n") + "\n";
  const outFile = path.join(releaseDir, "SHA256SUMS.txt");
  await fs.writeFile(outFile, output, "utf8");
  console.log(`Wrote ${outFile}`);
}

main().catch((err) => {
  console.error("release metadata failed:", err.message || err);
  process.exit(1);
});
