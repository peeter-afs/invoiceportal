const mariadb = require('mariadb');

let pool;

/**
 * Normalize DATABASE_URL: strip JDBC prefix, ensure mariadb:// scheme.
 * Supports: jdbc:mariadb://host:port/db, mariadb://host:port/db, mysql://host:port/db
 */
function normalizeDatabaseUrl(url) {
  let normalized = url.trim();
  // Strip jdbc: prefix
  if (normalized.startsWith('jdbc:')) {
    normalized = normalized.slice(5);
  }
  // Convert mysql:// to mariadb:// (mariadb driver prefers its own scheme)
  if (normalized.startsWith('mysql://')) {
    normalized = 'mariadb://' + normalized.slice('mysql://'.length);
  }
  return normalized;
}

function getPool() {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required');
    }

    const connectionUrl = normalizeDatabaseUrl(databaseUrl);
    console.log(`[db] Connecting to ${connectionUrl.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@')}`);
    pool = mariadb.createPool(connectionUrl);
  }

  return pool;
}

/**
 * Check database connectivity. Returns { ok: true } or { ok: false, error: string }.
 */
async function checkConnection() {
  try {
    await getPool().query('SELECT 1 AS ok');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function query(sql, params = []) {
  const rows = await getPool().query(sql, params);
  return rows;
}

module.exports = { getPool, query, checkConnection };
