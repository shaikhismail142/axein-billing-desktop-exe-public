#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

function run(scriptPath, env = {}) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run(path.join(root, "desktop", "scripts", "run-next-build.mjs"), {
  AXEIN_INCLUDE_KEYGEN_UI: "1",
});
run(path.join(root, "desktop", "scripts", "prepare-runtime.mjs"), {
  AXEIN_INCLUDE_KEYGEN_PRIVATE: "1",
  AXEIN_INCLUDE_KEYGEN_UI: "1",
});

const markerText = [
  "AxEin staff keygen runtime marker.",
  "Billing runtime must not contain this file.",
  `Generated at: ${new Date().toISOString()}`,
].join("\n");
const markerBase = path.join(root, "desktop", "runtime", "app", "standalone");
await fs.writeFile(path.join(markerBase, ".axein-keygen-runtime"), markerText, "utf8");
await fs.writeFile(path.join(markerBase, "AXEIN_KEYGEN_RUNTIME.flag"), markerText, "utf8");
