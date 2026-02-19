#!/usr/bin/env node
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

const runtimeNodeDir = path.join(root, "desktop", "runtime", "node");

function run(cmd, args, opts = {}) {
  const out = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (out.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (${out.status}): ${out.stderr?.trim() || out.stdout?.trim() || "unknown error"}`,
    );
  }
  return (out.stdout || "").trim();
}

function listMachODependencies(filePath) {
  const raw = run("otool", ["-L", filePath]);
  const lines = raw.split(/\r?\n/).slice(1);
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(" (")[0]?.trim())
    .filter(Boolean);
}

function isSystemLibrary(dep) {
  return (
    dep.startsWith("/usr/lib/") ||
    dep.startsWith("/System/Library/") ||
    dep.startsWith("/Library/Apple/System/Library/")
  );
}

function resolveDependencySource(dep, sourceFile, sourceNode) {
  if (dep.startsWith("/")) {
    return dep;
  }

  const sourceDir = path.dirname(sourceFile);
  const nodeBinDir = path.dirname(sourceNode);
  const nodeLibDir = path.resolve(nodeBinDir, "..", "lib");

  if (dep.startsWith("@loader_path/")) {
    const rel = dep.slice("@loader_path/".length);
    return path.resolve(sourceDir, rel);
  }

  if (dep.startsWith("@executable_path/")) {
    const rel = dep.slice("@executable_path/".length);
    return path.resolve(nodeBinDir, rel);
  }

  if (dep.startsWith("@rpath/")) {
    const rel = dep.slice("@rpath/".length);
    const candidates = [
      path.resolve(sourceDir, rel),
      path.resolve(sourceDir, "..", "lib", rel),
      path.resolve(nodeBinDir, rel),
      path.resolve(nodeLibDir, rel),
      path.resolve(nodeBinDir, "..", rel),
    ];
    for (const c of candidates) {
      if (fssync.existsSync(c)) {
        return c;
      }
    }
  }

  return null;
}

async function bundleMacDynamicLibraries(sourceNode, targetNode) {
  const libsDir = path.join(runtimeNodeDir, "lib");
  await fs.mkdir(libsDir, { recursive: true });

  const copiedByBaseName = new Map();
  const queued = [];

  const enqueueFrom = (sourceFile) => {
    const deps = listMachODependencies(sourceFile);
    queued.push({ sourceFile, deps });
  };

  enqueueFrom(sourceNode);

  while (queued.length > 0) {
    const { sourceFile, deps } = queued.shift();
    for (const dep of deps) {
      if (isSystemLibrary(dep)) {
        continue;
      }
      const resolved = resolveDependencySource(dep, sourceFile, sourceNode);
      if (!resolved || !fssync.existsSync(resolved)) {
        continue;
      }
      const base = path.basename(resolved);
      if (copiedByBaseName.has(base)) {
        continue;
      }
      const dest = path.join(libsDir, base);
      await fs.copyFile(resolved, dest);
      await fs.chmod(dest, 0o644);
      copiedByBaseName.set(base, { source: resolved, dest });
      enqueueFrom(resolved);
    }
  }

  const relinkFile = (filePath, sourceFile) => {
    const deps = listMachODependencies(sourceFile);
    for (const dep of deps) {
      if (isSystemLibrary(dep)) {
        continue;
      }
      const resolved = resolveDependencySource(dep, sourceFile, sourceNode);
      if (!resolved) {
        continue;
      }
      const base = path.basename(resolved);
      if (!copiedByBaseName.has(base)) {
        continue;
      }
      try {
        run("install_name_tool", ["-change", dep, `@rpath/${base}`, filePath]);
      } catch (_) {
        // ignore duplicate/unchanged entries
      }
    }
  };

  try {
    run("install_name_tool", ["-add_rpath", "@executable_path/lib", targetNode]);
  } catch (_) {
    // ignore if rpath already exists
  }

  relinkFile(targetNode, sourceNode);

  for (const [base, entry] of copiedByBaseName.entries()) {
    const filePath = entry.dest;
    try {
      run("install_name_tool", ["-id", `@rpath/${base}`, filePath]);
    } catch (_) {
      // ignore if not changeable
    }
    relinkFile(filePath, entry.source);
  }
}

async function main() {
  const explicit = process.env.AXEIN_NODE_BIN ? path.resolve(process.env.AXEIN_NODE_BIN) : null;
  const sourceNode = explicit || process.execPath;

  if (!fssync.existsSync(sourceNode)) {
    throw new Error(`Node binary not found at ${sourceNode}`);
  }

  await fs.mkdir(runtimeNodeDir, { recursive: true });

  const isWin = process.platform === "win32";
  const target = path.join(runtimeNodeDir, isWin ? "node.exe" : "node");

  await fs.copyFile(sourceNode, target);
  if (!isWin) {
    await fs.chmod(target, 0o755);
  }
  if (process.platform === "darwin") {
    await bundleMacDynamicLibraries(sourceNode, target);
  }

  const note = [
    "Bundled Node runtime for AxEin desktop.",
    `Source: ${sourceNode}`,
    `Generated at: ${new Date().toISOString()}`,
  ].join("\n");

  await fs.writeFile(path.join(runtimeNodeDir, "README.txt"), note, "utf8");
  console.log(`Bundled node runtime -> ${target}`);
}

main().catch((err) => {
  console.error("prepare-node-runtime failed:", err.message || err);
  process.exit(1);
});
