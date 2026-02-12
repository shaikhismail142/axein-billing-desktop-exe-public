#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function checkWithCandidates(candidates, args = ["--version"]) {
  let last = { ok: false, text: "not available" };
  for (const cmd of candidates) {
    const out = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8" });
    if (out.status === 0) {
      return { ok: true, text: (out.stdout || out.stderr || "").trim(), cmd };
    }
    last = { ok: false, text: (out.stderr || out.stdout || "").trim() || "not available", cmd };
  }
  return last;
}

function check(cmd, args = ["--version"]) {
  const candidates = [cmd];
  if (process.platform === "win32" && !cmd.toLowerCase().endsWith(".cmd")) {
    candidates.push(`${cmd}.cmd`);
  }
  return checkWithCandidates(candidates, args);
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
