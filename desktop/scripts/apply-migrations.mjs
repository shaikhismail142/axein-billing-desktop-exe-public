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
const REAPPLY_ON_BASELINE = new Set(["20260213_add_computer_limits.sql"]);

const OS_USER = process.env.USER || process.env.USERNAME || "postgres";

function hasExplicitPgEnv() {
  return ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"].some((k) => !!process.env[k]);
}

function defaultEnvConfig() {
  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || "5432"),
    user: process.env.PGUSER || "app",
    password: process.env.PGPASSWORD || "app",
    database: process.env.PGDATABASE || "app",
  };
}

function buildConnectionCandidates() {
  if (process.env.DATABASE_URL) {
    return [{ label: "DATABASE_URL", config: { connectionString: process.env.DATABASE_URL } }];
  }

  const candidates = [{ label: "PG env/default (app/app)", config: defaultEnvConfig() }];
  if (hasExplicitPgEnv()) return candidates;

  // Helpful local fallbacks for macOS/Linux development where local role matches shell user.
  const socketHosts = ["/tmp", "/var/run/postgresql"];
  for (const socketHost of socketHosts) {
    candidates.push({
      label: `local socket ${socketHost} (${OS_USER}/${OS_USER})`,
      config: { host: socketHost, port: 5432, user: OS_USER, database: OS_USER },
    });
    candidates.push({
      label: `local socket ${socketHost} (${OS_USER}/postgres)`,
      config: { host: socketHost, port: 5432, user: OS_USER, database: "postgres" },
    });
  }

  candidates.push({
    label: `localhost (${OS_USER}/${OS_USER})`,
    config: { host: "127.0.0.1", port: 5432, user: OS_USER, database: OS_USER },
  });
  candidates.push({
    label: `localhost (${OS_USER}/postgres)`,
    config: { host: "127.0.0.1", port: 5432, user: OS_USER, database: "postgres" },
  });

  return candidates;
}

function sanitizeError(err) {
  const code = err?.code ? ` [${err.code}]` : "";
  const message = err?.message || String(err);
  return `${message}${code}`;
}

async function connectWithFallback() {
  const attempts = [];

  for (const candidate of buildConnectionCandidates()) {
    const pool = new Pool({
      ...candidate.config,
      max: 1,
      connectionTimeoutMillis: 3500,
    });

    try {
      const client = await pool.connect();
      return { pool, client, candidate };
    } catch (err) {
      attempts.push(`- ${candidate.label}: ${sanitizeError(err)}`);
      await pool.end().catch(() => {});
    }
  }

  const hint = [
    "Unable to connect to Postgres with any local fallback.",
    "Provide explicit connection and rerun:",
    "  DATABASE_URL=postgresql://<user>:<pass>@<host>:<port>/<db> npm run desktop:db:migrate",
    "or",
    "  PGHOST=127.0.0.1 PGPORT=5432 PGUSER=<user> PGPASSWORD=<pass> PGDATABASE=<db> npm run desktop:db:migrate",
  ].join("\n");
  throw new Error(`${hint}\nTried:\n${attempts.join("\n")}`);
}

async function listMigrations() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => path.join(migrationsDir, e.name))
    .sort((a, b) => a.localeCompare(b));
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client) {
  const rs = await client.query(`SELECT name FROM public.schema_migrations`);
  return new Set((rs.rows || []).map((r) => String(r.name)));
}

async function markMigration(client, name) {
  await client.query(
    `INSERT INTO public.schema_migrations (name)
     VALUES ($1)
     ON CONFLICT (name) DO NOTHING`,
    [name]
  );
}

async function hasPreexistingSchema(client) {
  const rs = await client.query(`
    SELECT
      to_regclass('public.settings') IS NOT NULL AS has_settings,
      to_regclass('public.products') IS NOT NULL AS has_products,
      to_regclass('public.businesses') IS NOT NULL AS has_businesses,
      to_regclass('public.roles') IS NOT NULL AS has_roles
  `);
  const row = rs.rows?.[0] || {};
  return Boolean(row.has_businesses || row.has_roles || (row.has_settings && row.has_products));
}

async function main() {
  const migrations = await listMigrations();

  if (migrations.length === 0) {
    console.log("No migrations found.");
    return;
  }

  const { pool, client, candidate } = await connectWithFallback();
  console.log(`Connected to Postgres via: ${candidate.label}`);

  try {
    await ensureMigrationsTable(client);
    let applied = await getAppliedMigrations(client);

    if (applied.size === 0 && (await hasPreexistingSchema(client))) {
      console.log("Detected existing schema. Baselining historical migrations to avoid replay conflicts.");
      for (const file of migrations) {
        const name = path.basename(file);
        if (REAPPLY_ON_BASELINE.has(name)) continue;
        await markMigration(client, name);
      }
      applied = await getAppliedMigrations(client);
    }

    for (const file of migrations) {
      const name = path.basename(file);
      if (applied.has(name)) {
        console.log(`Skipping ${name} (already applied)`);
        continue;
      }

      const sql = await fs.readFile(file, "utf8");
      process.stdout.write(`Applying ${name} ... `);
      await client.query(sql);
      await markMigration(client, name);
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
