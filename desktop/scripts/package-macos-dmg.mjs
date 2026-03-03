#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
    args.set(key, value);
  }
  return args;
}

function run(cmd, cmdArgs) {
  const out = spawnSync(cmd, cmdArgs, { stdio: "pipe", encoding: "utf8" });
  if (out.status !== 0) {
    const stderr = (out.stderr || "").trim();
    const stdout = (out.stdout || "").trim();
    throw new Error(`${cmd} ${cmdArgs.join(" ")} failed: ${stderr || stdout || `exit ${out.status}`}`);
  }
  return out.stdout || "";
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("This script only runs on macOS.");
  }

  const args = parseArgs(process.argv.slice(2));
  const appPath = args.get("app");
  const outDmg = args.get("out");
  const volname = args.get("volname");

  if (!appPath || !outDmg || !volname) {
    throw new Error("Usage: node package-macos-dmg.mjs --app <path/to/App.app> --out <path/to/file.dmg> --volname <Volume Name>");
  }

  const appAbs = path.resolve(appPath);
  const outAbs = path.resolve(outDmg);
  const outDir = path.dirname(outAbs);
  const appStat = await fs.stat(appAbs).catch(() => null);
  if (!appStat || !appStat.isDirectory() || !appAbs.endsWith(".app")) {
    throw new Error(`App bundle not found: ${appAbs}`);
  }

  await fs.mkdir(outDir, { recursive: true });
  await fs.rm(outAbs, { force: true }).catch(() => {});

  // Re-sign bundle ad-hoc to avoid broken/partial signatures from generated output.
  run("codesign", ["--force", "--deep", "--sign", "-", appAbs]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appAbs]);

  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "axein-macos-stage-"));
  const stageApp = path.join(stage, path.basename(appAbs));
  try {
    run("cp", ["-R", appAbs, stageApp]);
    run("hdiutil", [
      "create",
      "-volname",
      volname,
      "-srcfolder",
      stage,
      "-ov",
      "-format",
      "UDZO",
      outAbs,
    ]);

    // Best-effort ad-hoc signature on DMG container.
    run("codesign", ["--force", "--sign", "-", outAbs]);
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }

  // Verify packaged app signature by mounting and checking bundle.
  const mount = await fs.mkdtemp(path.join(os.tmpdir(), "axein-macos-mount-"));
  try {
    run("hdiutil", ["attach", outAbs, "-mountpoint", mount, "-nobrowse", "-quiet"]);
    const mountedApp = path.join(mount, path.basename(appAbs));
    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", mountedApp]);
  } finally {
    run("hdiutil", ["detach", mount, "-quiet"]);
    await fs.rm(mount, { recursive: true, force: true }).catch(() => {});
  }

  process.stdout.write(`${outAbs}\n`);
}

main().catch((err) => {
  process.stderr.write(`package-macos-dmg failed: ${err?.message || err}\n`);
  process.exit(1);
});
