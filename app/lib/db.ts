import { Pool } from "pg";

type QueryArgs = [text: string, params?: any[]];
type QueryResult = { rows: any[]; rowCount?: number };

type PgLike = {
  query: (...args: QueryArgs) => Promise<QueryResult>;
  connect: () => Promise<PgClientLike>;
  end: () => Promise<void>;
};

type PgClientLike = {
  query: (...args: QueryArgs) => Promise<QueryResult>;
  release: () => void;
};

type PoolLike = {
  query: (...args: QueryArgs) => Promise<QueryResult>;
  connect: () => Promise<PgClientLike>;
  end: () => Promise<void>;
};

type PoolConfigLike = Record<string, any>;

type Candidate = {
  label: string;
  config: PoolConfigLike;
};

const connString = process.env.DATABASE_URL?.trim();
const isDesktopRuntime = process.env.AXEIN_DESKTOP === "1";
const osUser = process.env.USER || process.env.USERNAME || "postgres";

const defaultPort = Number(process.env.PGPORT || "5432");
const explicitPgHost = process.env.PGHOST || process.env.DB_HOST;
const explicitPgUser = process.env.PGUSER || process.env.DB_USER;
const explicitPgPass = process.env.PGPASSWORD || process.env.DB_PASSWORD;
const explicitPgDb = process.env.PGDATABASE || process.env.DB_NAME;

function hasExplicitPgEnv() {
  return ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"].some(
    (key) => Boolean(process.env[key])
  );
}

function isLocalHost(host: string | undefined) {
  if (!host) return true;
  const value = String(host).trim().toLowerCase();
  if (!value) return true;
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value.startsWith("/");
}

function isLocalDatabaseUrl(connectionString: string) {
  try {
    const u = new URL(connectionString);
    return isLocalHost(u.hostname || u.host);
  } catch {
    return false;
  }
}

function baseConfig(): PoolConfigLike {
  return {
    host: explicitPgHost || (isDesktopRuntime ? "127.0.0.1" : "db"),
    port: defaultPort,
    user: explicitPgUser || "app",
    password: explicitPgPass || "app",
    database: explicitPgDb || "app",
    max: 10,
    connectionTimeoutMillis: 2000,
  };
}

function localFallbackCandidates(): Candidate[] {
  const list: Candidate[] = [];
  const includeSockets = process.platform !== "win32";
  const socketHosts = ["/tmp", "/var/run/postgresql"];

  if (includeSockets) {
    for (const host of socketHosts) {
      list.push({
        label: `local socket ${host} (${osUser}/${osUser})`,
        config: { host, port: 5432, user: osUser, database: osUser, max: 10, connectionTimeoutMillis: 1500 },
      });
      list.push({
        label: `local socket ${host} (${osUser}/postgres)`,
        config: { host, port: 5432, user: osUser, database: "postgres", max: 10, connectionTimeoutMillis: 1500 },
      });
    }
  }

  list.push({
    label: `localhost (${osUser}/${osUser})`,
    config: { host: "127.0.0.1", port: 5432, user: osUser, database: osUser, max: 10, connectionTimeoutMillis: 1500 },
  });
  list.push({
    label: `localhost (${osUser}/postgres)`,
    config: { host: "127.0.0.1", port: 5432, user: osUser, database: "postgres", max: 10, connectionTimeoutMillis: 1500 },
  });
  list.push({
    label: "localhost (postgres/postgres)",
    config: { host: "127.0.0.1", port: 5432, user: "postgres", database: "postgres", max: 10, connectionTimeoutMillis: 1500 },
  });

  return list;
}

function buildCandidates(): Candidate[] {
  const candidates: Candidate[] = [];
  const hasPgEnv = hasExplicitPgEnv();

  if (connString) {
    candidates.push({
      label: "DATABASE_URL",
      config: { connectionString: connString, max: 10, connectionTimeoutMillis: 2500 },
    });
  }

  if (!connString || hasPgEnv) {
    candidates.push({ label: "PG env/default", config: baseConfig() });
  }

  const localByBase = isLocalHost(baseConfig().host as string | undefined);
  const localByUrl = connString ? isLocalDatabaseUrl(connString) : false;
  const shouldTryLocalFallbacks = isDesktopRuntime && (!connString || localByBase || localByUrl);

  if (shouldTryLocalFallbacks) {
    candidates.push(...localFallbackCandidates());
  }

  // Stable ordering with duplicate collapse.
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.label}:${JSON.stringify(candidate.config)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeError(err: unknown) {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.code ? ` [${e.code}]` : "";
  return `${e?.message || String(err)}${code}`;
}

let activePool: PoolLike | null = null;
let activeLabel: string | null = null;
let resolvingPool: Promise<PoolLike> | null = null;

async function resolvePool(): Promise<PoolLike> {
  if (activePool) return activePool;
  if (resolvingPool) return resolvingPool;

  resolvingPool = (async () => {
    const attempts: string[] = [];
    const candidates = buildCandidates();

    for (const candidate of candidates) {
      const p = new Pool(candidate.config);
      try {
        const c = await p.connect();
        try {
          await c.query("SELECT 1");
        } finally {
          c.release();
        }
        activePool = p;
        activeLabel = candidate.label;
        if (isDesktopRuntime) {
          console.log(`[db] connected via ${candidate.label}`);
        }
        return p;
      } catch (err) {
        attempts.push(`- ${candidate.label}: ${sanitizeError(err)}`);
        await p.end().catch(() => {});
      }
    }

    throw new Error(`Unable to connect to Postgres.\nTried:\n${attempts.join("\n")}`);
  })();

  try {
    return await resolvingPool;
  } finally {
    resolvingPool = null;
  }
}

export const pool: PgLike = {
  async query(...args: QueryArgs) {
    const p = await resolvePool();
    return (await p.query(...args)) as QueryResult;
  },
  async connect() {
    const p = await resolvePool();
    return p.connect();
  },
  async end() {
    if (!activePool) return;
    await activePool.end();
    activePool = null;
    activeLabel = null;
  },
};

/** Return the shared pool as a pg-like object. */
export function getDb(): PgLike {
  return pool;
}

export function getDbConnectionLabel() {
  return activeLabel;
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
