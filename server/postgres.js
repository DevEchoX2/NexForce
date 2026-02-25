const crypto = require("crypto");
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL || "";
const POSTGRES_ENABLED = Boolean(DATABASE_URL);

let pool = null;
let initialized = false;

const getPool = () => {
  if (!POSTGRES_ENABLED) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSL_REQUIRE === "true" ? { rejectUnauthorized: false } : undefined
    });
  }

  return pool;
};

const initializePostgres = async () => {
  if (!POSTGRES_ENABLED || initialized) {
    return;
  }

  const client = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        tier TEXT NOT NULL,
        password_salt TEXT,
        password_hash TEXT,
        created_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS launch_tickets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        game_slug TEXT NOT NULL,
        provider TEXT,
        provider_account_id TEXT,
        launch_url TEXT NOT NULL,
        nonce_hash TEXT NOT NULL,
        signature TEXT NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        payload_json JSONB NOT NULL
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_launch_tickets_expires_at ON launch_tickets(expires_at);
    `);

    initialized = true;
  } finally {
    client.release();
  }
};

const toUser = (row) => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    tier: row.tier,
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
};

const toAuthSession = (row) => {
  if (!row) {
    return null;
  }

  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null
  };
};

const findUserByEmail = async (email) => {
  const result = await getPool().query(
    `SELECT * FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  return toUser(result.rows[0]);
};

const findUserById = async (id) => {
  const result = await getPool().query(
    `SELECT * FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return toUser(result.rows[0]);
};

const findFirstUser = async () => {
  const result = await getPool().query(`SELECT * FROM users ORDER BY created_at NULLS LAST, id ASC LIMIT 1`);
  return toUser(result.rows[0]);
};

const createUser = async (user) => {
  await getPool().query(
    `
      INSERT INTO users (id, name, email, tier, password_salt, password_hash, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)
    `,
    [
      user.id,
      user.name,
      user.email,
      user.tier,
      user.passwordSalt,
      user.passwordHash,
      user.createdAt,
      user.updatedAt
    ]
  );
};

const updateUserUpdatedAt = async (userId, updatedAtIso) => {
  await getPool().query(
    `UPDATE users SET updated_at = $2::timestamptz WHERE id = $1`,
    [userId, updatedAtIso]
  );
};

const pruneExpiredAuthSessions = async () => {
  await getPool().query(`DELETE FROM auth_sessions WHERE expires_at IS NOT NULL AND expires_at <= NOW()`);
};

const createAuthSession = async ({ token, userId, createdAt, expiresAt }) => {
  await getPool().query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
  await getPool().query(
    `
      INSERT INTO auth_sessions (token, user_id, created_at, expires_at)
      VALUES ($1, $2, $3::timestamptz, $4::timestamptz)
    `,
    [token, userId, createdAt, expiresAt]
  );
};

const findSessionByToken = async (token) => {
  const result = await getPool().query(
    `SELECT * FROM auth_sessions WHERE token = $1 LIMIT 1`,
    [token]
  );
  return toAuthSession(result.rows[0]);
};

const revokeSessionByToken = async (token) => {
  await getPool().query(`DELETE FROM auth_sessions WHERE token = $1`, [token]);
};

const storeLaunchTicket = async (ticket) => {
  const nonceHash = crypto.createHash("sha256").update(ticket.nonce).digest("hex");
  await getPool().query(
    `
      INSERT INTO launch_tickets (
        id, user_id, session_id, game_slug, provider, provider_account_id,
        launch_url, nonce_hash, signature, issued_at, expires_at, payload_json
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10::timestamptz, $11::timestamptz, $12::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        session_id = EXCLUDED.session_id,
        game_slug = EXCLUDED.game_slug,
        provider = EXCLUDED.provider,
        provider_account_id = EXCLUDED.provider_account_id,
        launch_url = EXCLUDED.launch_url,
        nonce_hash = EXCLUDED.nonce_hash,
        signature = EXCLUDED.signature,
        issued_at = EXCLUDED.issued_at,
        expires_at = EXCLUDED.expires_at,
        payload_json = EXCLUDED.payload_json,
        consumed_at = NULL
    `,
    [
      ticket.id,
      ticket.userId,
      ticket.sessionId,
      ticket.gameSlug,
      ticket.provider,
      ticket.providerAccountId,
      ticket.launchUrl,
      nonceHash,
      ticket.signature,
      ticket.issuedAt,
      ticket.expiresAt,
      JSON.stringify(ticket)
    ]
  );
};

const getLaunchTicketById = async (ticketId) => {
  const result = await getPool().query(
    `SELECT * FROM launch_tickets WHERE id = $1 LIMIT 1`,
    [ticketId]
  );

  if (!result.rows[0]) {
    return null;
  }

  const row = result.rows[0];
  return {
    ...row.payload_json,
    consumedAt: row.consumed_at ? new Date(row.consumed_at).toISOString() : null,
    storedSignature: row.signature,
    storedNonceHash: row.nonce_hash
  };
};

const consumeLaunchTicket = async (ticketId) => {
  await getPool().query(
    `UPDATE launch_tickets SET consumed_at = NOW() WHERE id = $1 AND consumed_at IS NULL`,
    [ticketId]
  );
};

const postgresHealth = async () => {
  if (!POSTGRES_ENABLED) {
    return { enabled: false, status: "disabled" };
  }

  try {
    const result = await getPool().query("SELECT NOW() AS now");
    return { enabled: true, status: "ok", now: result.rows[0].now };
  } catch (error) {
    return { enabled: true, status: "error", error: error.message };
  }
};

module.exports = {
  POSTGRES_ENABLED,
  initializePostgres,
  findUserByEmail,
  findUserById,
  findFirstUser,
  createUser,
  updateUserUpdatedAt,
  pruneExpiredAuthSessions,
  createAuthSession,
  findSessionByToken,
  revokeSessionByToken,
  storeLaunchTicket,
  getLaunchTicketById,
  consumeLaunchTicket,
  postgresHealth
};
