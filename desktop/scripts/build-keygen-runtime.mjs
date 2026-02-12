#!/usr/bin/env node
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

run(path.join(root, "desktop", "scripts", "run-next-build.mjs"));
run(path.join(root, "desktop", "scripts", "prepare-runtime.mjs"), {
  AXEIN_INCLUDE_KEYGEN_PRIVATE: "1",
});
