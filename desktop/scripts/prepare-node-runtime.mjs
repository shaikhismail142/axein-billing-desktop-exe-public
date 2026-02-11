#!/usr/bin/env node
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

const runtimeNodeDir = path.join(root, "desktop", "runtime", "node");

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
