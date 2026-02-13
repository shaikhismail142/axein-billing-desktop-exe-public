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

const nsisDir = path.join(root, "desktop", "src-tauri", "target", "release", "bundle", "nsis");
const releaseDir = path.join(root, "desktop", "release");
const checksumsPath = path.join(releaseDir, "SHA256SUMS.txt");
const reportPath = path.join(releaseDir, "installer-verification.json");
const tauriConfigPath = path.join(root, "desktop", "src-tauri", "tauri.conf.json");

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const allowMissing = args.has("--allow-missing");
const requireSigned = process.env.AXEIN_REQUIRE_SIGNED === "1";

function toIso(ms) {
  return new Date(ms).toISOString();
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fssync.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function parseSha256Sums(raw) {
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^([a-fA-F0-9]{64})\s+(.+)$/);
    if (!m) continue;
    const digest = m[1].toLowerCase();
    const fileName = m[2].trim();
    map.set(fileName, digest);
  }
  return map;
}

function powershellAvailable() {
  const exe = process.platform === "win32" ? "powershell" : "pwsh";
  const probe = spawnSync(exe, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
    stdio: "pipe",
    encoding: "utf8",
  });
  if (probe.status === 0) return exe;
  if (process.platform === "win32") return null;
  const winFallback = spawnSync("powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
    stdio: "pipe",
    encoding: "utf8",
  });
  return winFallback.status === 0 ? "powershell" : null;
}

function getAuthenticodeStatus(exePath) {
  const shell = powershellAvailable();
  if (!shell) {
    return { available: false, status: "unknown", statusMessage: "PowerShell not available" };
  }

  const command = [
    "$sig = Get-AuthenticodeSignature -FilePath",
    `'${exePath.replace(/'/g, "''")}'`,
    ";",
    "$o = [PSCustomObject]@{",
    "Status = [string]$sig.Status;",
    "StatusMessage = [string]$sig.StatusMessage;",
    "Signer = if ($sig.SignerCertificate) { [string]$sig.SignerCertificate.Subject } else { '' };",
    "Thumbprint = if ($sig.SignerCertificate) { [string]$sig.SignerCertificate.Thumbprint } else { '' };",
    "};",
    "$o | ConvertTo-Json -Compress",
  ].join(" ");

  const out = spawnSync(shell, ["-NoProfile", "-Command", command], {
    stdio: "pipe",
    encoding: "utf8",
  });

  if (out.status !== 0) {
    return {
      available: true,
      status: "unknown",
      statusMessage: (out.stderr || out.stdout || "Auth signature probe failed").trim(),
    };
  }

  try {
    const parsed = JSON.parse((out.stdout || "").trim() || "{}");
    return {
      available: true,
      status: String(parsed.Status || "unknown"),
      statusMessage: String(parsed.StatusMessage || ""),
      signer: String(parsed.Signer || ""),
      thumbprint: String(parsed.Thumbprint || ""),
    };
  } catch {
    return {
      available: true,
      status: "unknown",
      statusMessage: "Unable to parse Authenticode output",
    };
  }
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readTauriConfig() {
  const raw = await fs.readFile(tauriConfigPath, "utf8");
  return JSON.parse(raw);
}

async function listInstallers() {
  if (!(await fileExists(nsisDir))) return [];
  const entries = await fs.readdir(nsisDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".exe"))
    .map((e) => path.join(nsisDir, e.name));
}

async function readChecksums() {
  if (!(await fileExists(checksumsPath))) return new Map();
  const raw = await fs.readFile(checksumsPath, "utf8");
  return parseSha256Sums(raw);
}

async function verifyOneInstaller(installerPath, checksumsMap) {
  const stat = await fs.stat(installerPath);
  const digest = await sha256(installerPath);
  const fileName = path.basename(installerPath);
  const expected = checksumsMap.get(fileName) || null;
  const checksumMatch = expected ? expected === digest : null;
  const signature = getAuthenticodeStatus(installerPath);

  const issues = [];
  if (stat.size < 5 * 1024 * 1024) {
    issues.push("Installer size is unexpectedly small (<5MB)");
  }
  if (expected && checksumMatch === false) {
    issues.push("Checksum mismatch against SHA256SUMS.txt");
  }
  if (strict && !expected) {
    issues.push("Missing checksum entry in SHA256SUMS.txt");
  }
  if (requireSigned && signature.status.toLowerCase() !== "valid") {
    issues.push(`Authenticode signature is not valid (${signature.status})`);
  }

  return {
    file_name: fileName,
    full_path: installerPath,
    size_bytes: stat.size,
    modified_at: toIso(stat.mtimeMs),
    sha256: digest,
    expected_sha256: expected,
    checksum_match: checksumMatch,
    signature,
    issues,
  };
}

async function main() {
  await fs.mkdir(releaseDir, { recursive: true });
  const tauri = await readTauriConfig();
  const installers = await listInstallers();
  const installerNames = installers.map((installer) => path.basename(installer).toLowerCase());

  if (installers.length === 0) {
    const message = "No NSIS installer .exe found under desktop/src-tauri/target/release/bundle/nsis.";
    if (allowMissing) {
      console.log(`${message} --allow-missing set, skipping.`);
      return;
    }
    if (process.platform !== "win32") {
      console.log(`${message} Skipping verification on non-Windows host.`);
      return;
    }
    throw new Error(`${message} Run npm run desktop:build first.`);
  }

  const requiredNameFragments = ["axein billing desktop", "axein license keygen"];
  const missingInstallers = requiredNameFragments.filter(
    (fragment) => !installerNames.some((name) => name.includes(fragment))
  );

  const checksums = await readChecksums();
  const results = [];
  for (const installer of installers) {
    results.push(await verifyOneInstaller(installer, checksums));
  }

  const allIssues = results.flatMap((r) => r.issues.map((issue) => `${r.file_name}: ${issue}`));
  for (const missing of missingInstallers) {
    allIssues.push(`missing installer containing name fragment "${missing}"`);
  }
  const report = {
    generated_at: new Date().toISOString(),
    host_platform: process.platform,
    strict,
    require_signed: requireSigned,
    tauri: {
      product_name: tauri.productName,
      version: tauri.version,
      identifier: tauri.identifier,
      bundle_targets: tauri.bundle?.targets || [],
    },
    installer_count: results.length,
    checksum_file_present: checksums.size > 0,
    installers: results,
    issues: allIssues,
  };

  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (allIssues.length > 0) {
    for (const issue of allIssues) {
      console.error(`[verify] ${issue}`);
    }
    throw new Error(`Installer verification failed with ${allIssues.length} issue(s). See ${reportPath}`);
  }

  console.log(`Installer verification passed. Report: ${reportPath}`);
}

main().catch((err) => {
  console.error("installer verification failed:", err.message || err);
  process.exit(1);
});
