import { Pool } from "pg";

/**
 * Prefer DATABASE_URL when present.
 * Otherwise use local desktop defaults (127.0.0.1 with app/app credentials)
 * unless overridden via PG* env variables.
 */

const connString = process.env.DATABASE_URL;
const isDesktopRuntime = process.env.AXEIN_DESKTOP === "1";

export const pool = connString
  ? new Pool({ connectionString: connString, max: 10 })
  : new Pool({
      host: process.env.PGHOST || process.env.DB_HOST || (isDesktopRuntime ? "127.0.0.1" : "db"),
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || "app",
      password: process.env.PGPASSWORD || "app",
      database: process.env.PGDATABASE || "app",
      max: 10,
    });

/** Minimal pg-like type (avoids TS 'Pool' type namespace issues) */
type PgLike = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
  connect?: () => Promise<{
    query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
    release: () => void;
  }>;
};

/** Return the shared pool as a pg-like object */
export function getDb(): PgLike {
  return pool as unknown as PgLike;
}

// Optional ping for health checks
export async function ping() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
