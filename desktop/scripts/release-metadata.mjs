#!/usr/bin/env node
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const bundleDir = path.join(root, "desktop", "src-tauri", "target", "release", "bundle", "nsis");
const releaseDir = path.join(root, "desktop", "release");
const manifestFile = path.join(releaseDir, "release-manifest.json");
const releaseNotesTemplateFile = path.join(releaseDir, "RELEASE_NOTES.template.md");
const tauriConfigFile = path.join(root, "desktop", "src-tauri", "tauri.conf.json");
const packageJsonFile = path.join(root, "package.json");

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fssync.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function git(cmdArgs) {
  const out = spawnSync("git", cmdArgs, { cwd: root, stdio: "pipe", encoding: "utf8" });
  if (out.status !== 0) return "";
  return (out.stdout || "").trim();
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes || 0);
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

async function main() {
  await fs.mkdir(releaseDir, { recursive: true });

  const [tauriRaw, pkgRaw] = await Promise.all([
    fs.readFile(tauriConfigFile, "utf8"),
    fs.readFile(packageJsonFile, "utf8"),
  ]);
  const tauri = JSON.parse(tauriRaw);
  const pkg = JSON.parse(pkgRaw);

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
  const artifacts = [];
  for (const file of files) {
    const stat = await fs.stat(file);
    const digest = await sha256(file);
    const name = path.basename(file);
    lines.push(`${digest}  ${name}`);
    artifacts.push({
      file_name: name,
      full_path: file,
      size_bytes: stat.size,
      size_human: formatBytes(stat.size),
      modified_at: stat.mtime.toISOString(),
      sha256: digest,
    });
  }

  const output = lines.join("\n") + "\n";
  const outFile = path.join(releaseDir, "SHA256SUMS.txt");
  await fs.writeFile(outFile, output, "utf8");

  const manifest = {
    generated_at: new Date().toISOString(),
    git: {
      branch: git(["branch", "--show-current"]),
      commit: git(["rev-parse", "HEAD"]),
      commit_short: git(["rev-parse", "--short", "HEAD"]),
    },
    app: {
      package_name: pkg.name,
      package_version: pkg.version,
      tauri_product_name: tauri.productName,
      tauri_version: tauri.version,
      tauri_identifier: tauri.identifier,
      bundle_targets: tauri.bundle?.targets || [],
    },
    artifacts,
  };
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const artifactLines = artifacts
    .map((a) => `- \`${a.file_name}\` (${a.size_human}, sha256: \`${a.sha256}\`)`)
    .join("\n");
  const releaseNotesTemplate = [
    "# AxEin Desktop Release Notes",
    "",
    `- Build date (UTC): ${manifest.generated_at}`,
    `- Branch: ${manifest.git.branch || "(unknown)"}`,
    `- Commit: ${manifest.git.commit_short || manifest.git.commit || "(unknown)"}`,
    `- App version: ${manifest.app.tauri_version || manifest.app.package_version || "(unknown)"}`,
    "",
    "## Artifacts",
    artifactLines,
    "",
    "## Validation",
    "- [ ] npm run lint",
    "- [ ] npm run desktop:web:build",
    "- [ ] npm run desktop:db:migrate",
    "- [ ] npm run desktop:lan:selftest",
    "- [ ] npm run desktop:smoke",
    "- [ ] npm run desktop:release:verify -- --strict",
    "",
    "## Notes",
    "- Fill functional changes for this release.",
    "- Fill known risks and rollback notes.",
    "",
  ].join("\n");
  await fs.writeFile(releaseNotesTemplateFile, releaseNotesTemplate, "utf8");

  console.log(`Wrote ${outFile}`);
  console.log(`Wrote ${manifestFile}`);
  console.log(`Wrote ${releaseNotesTemplateFile}`);
}

main().catch((err) => {
  console.error("release metadata failed:", err.message || err);
  process.exit(1);
});
