#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const migrationsDir = path.join(root, "db", "migrations");

function buildConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const host = process.env.PGHOST || "127.0.0.1";
  const port = process.env.PGPORT || "5432";
  const user = process.env.PGUSER || "app";
  const password = process.env.PGPASSWORD || "app";
  const database = process.env.PGDATABASE || "app";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

async function listMigrations() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => path.join(migrationsDir, e.name))
    .sort((a, b) => a.localeCompare(b));
}

async function main() {
  const connectionString = buildConnectionString();
  const migrations = await listMigrations();

  if (migrations.length === 0) {
    console.log("No migrations found.");
    return;
  }

  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();

  try {
    for (const file of migrations) {
      const sql = await fs.readFile(file, "utf8");
      const name = path.basename(file);
      process.stdout.write(`Applying ${name} ... `);
      await client.query(sql);
      console.log("ok");
    }
    console.log("All migrations applied.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message || err);
  process.exit(1);
});
