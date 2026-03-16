#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const { getPool, query } = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (version)
    ) ENGINE=InnoDB
  `);
}

async function getAppliedMigrations() {
  const rows = await query('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(rows.map((r) => r.version));
}

async function getMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files;
}

async function runMigration(filename) {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filePath, 'utf-8');

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    // Split on semicolons but respect multi-line statements
    const statements = sql
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await conn.execute(statement);
    }

    await conn.execute(
      'INSERT INTO schema_migrations (version) VALUES (?)',
      [filename]
    );
    console.log(`  Applied: ${filename}`);
  } finally {
    conn.release();
  }
}

async function migrate() {
  console.log('Running migrations...');
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const files = await getMigrationFiles();

  let count = 0;
  for (const file of files) {
    if (!applied.has(file)) {
      await runMigration(file);
      count++;
    }
  }

  if (count === 0) {
    console.log('  No new migrations to apply.');
  } else {
    console.log(`  Applied ${count} migration(s).`);
  }

  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
