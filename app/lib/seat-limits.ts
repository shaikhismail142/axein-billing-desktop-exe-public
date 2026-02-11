type QueryResultRow = Record<string, unknown>;

type Queryable = {
  query: (...args: any[]) => Promise<{ rows: QueryResultRow[] }>;
};

export type SeatUsage = {
  seat_limit: number;
  computer_limit: number;
  active_users: number;
  active_clients: number;
  used_seats: number;
  remaining_seats: number;
  active_computers: number;
  remaining_computers: number;
};

function toInt(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function isMissingDbShapeError(err: unknown) {
  const message = String((err as { message?: string } | null)?.message || "").toLowerCase();
  return (
    (message.includes("relation") && (message.includes("does not exist") || message.includes("undefined table"))) ||
    (message.includes("column") && message.includes("does not exist")) ||
    message.includes("undefined column")
  );
}

async function resolveSeatLimit(db: Queryable, businessId: number) {
  try {
    const rs = await db.query(
      `SELECT COALESCE(
          (
            SELECT l.user_limit
              FROM licenses l
             WHERE l.business_id = $1
               AND lower(l.status) = 'active'
               AND (l.valid_to IS NULL OR l.valid_to >= NOW())
             ORDER BY l.valid_to DESC NULLS LAST, l.id DESC
             LIMIT 1
          ),
          b.user_limit
        ) AS user_limit
         FROM businesses b
        WHERE b.id = $1
        LIMIT 1`,
      [businessId]
    );
    return Math.max(1, toInt(rs.rows?.[0]?.user_limit, 1));
  } catch (err) {
    if (!isMissingDbShapeError(err)) throw err;
    const fallbackRs = await db.query(
      `SELECT user_limit
         FROM businesses
        WHERE id = $1
        LIMIT 1`,
      [businessId]
    );
    return Math.max(1, toInt(fallbackRs.rows?.[0]?.user_limit, 1));
  }
}

async function resolveComputerLimit(db: Queryable, businessId: number) {
  try {
    const rs = await db.query(
      `SELECT COALESCE(
          (
            SELECT l.computer_limit
              FROM licenses l
             WHERE l.business_id = $1
               AND lower(l.status) = 'active'
               AND (l.valid_to IS NULL OR l.valid_to >= NOW())
             ORDER BY l.valid_to DESC NULLS LAST, l.id DESC
             LIMIT 1
          ),
          b.computer_limit
        ) AS computer_limit
         FROM businesses b
        WHERE b.id = $1
        LIMIT 1`,
      [businessId]
    );
    return Math.max(1, toInt(rs.rows?.[0]?.computer_limit, 1));
  } catch (err) {
    if (!isMissingDbShapeError(err)) throw err;
    const fallbackRs = await db.query(
      `SELECT user_limit
         FROM businesses
        WHERE id = $1
        LIMIT 1`,
      [businessId]
    );
    return Math.max(1, toInt(fallbackRs.rows?.[0]?.user_limit, 1));
  }
}

async function resolveActiveClients(db: Queryable, businessId: number) {
  try {
    const rs = await db.query(
      `SELECT COUNT(*)::int AS cnt
         FROM lan_clients
        WHERE business_id = $1
          AND status = 'active'`,
      [businessId]
    );
    return toInt(rs.rows?.[0]?.cnt, 0);
  } catch (err) {
    if (isMissingDbShapeError(err)) return 0;
    throw err;
  }
}

export async function resolveSeatUsage(db: Queryable, businessId: number): Promise<SeatUsage> {
  const [activeUsersRs, activeClients, seatLimit, computerLimit] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS cnt
         FROM users
        WHERE business_id = $1
          AND status = 'active'`,
      [businessId]
    ),
    resolveActiveClients(db, businessId),
    resolveSeatLimit(db, businessId),
    resolveComputerLimit(db, businessId),
  ]);

  const activeUsers = toInt(activeUsersRs.rows?.[0]?.cnt, 0);
  const usedSeats = activeUsers + activeClients;
  const activeComputers = activeClients + 1; // host app instance + approved LAN clients
  const remainingSeats = Math.max(0, seatLimit - usedSeats);
  const remainingComputers = Math.max(0, computerLimit - activeComputers);

  return {
    seat_limit: seatLimit,
    computer_limit: computerLimit,
    active_users: activeUsers,
    active_clients: activeClients,
    used_seats: usedSeats,
    remaining_seats: remainingSeats,
    active_computers: activeComputers,
    remaining_computers: remainingComputers,
  };
}
