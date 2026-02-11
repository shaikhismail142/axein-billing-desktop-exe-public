#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function check(cmd, args = ["--version"]) {
  const out = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8" });
  return out.status === 0
    ? { ok: true, text: (out.stdout || out.stderr || "").trim() }
    : { ok: false, text: (out.stderr || out.stdout || "").trim() };
}

const checks = [
  ["node", ["--version"]],
  ["npm", ["--version"]],
  ["cargo", ["--version"]],
  ["rustc", ["--version"]],
];

let failed = false;
for (const [cmd, args] of checks) {
  const c = check(cmd, args);
  if (c.ok) {
    console.log(`[ok] ${cmd}: ${c.text}`);
  } else {
    failed = true;
    console.log(`[missing] ${cmd}: ${c.text || "not available"}`);
  }
}

if (failed) {
  console.log("\nDesktop build prerequisites are incomplete.");
  process.exit(2);
}

console.log("\nDesktop build prerequisites look good.");
