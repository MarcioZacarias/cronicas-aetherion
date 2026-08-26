// Acesso ao PostgreSQL e criação do schema.
// As migrações são idempotentes e rodam no boot: o serviço sobe sozinho
// num servidor limpo, sem passo manual de migração.

import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não definida (esperada em /etc/aetherion/env)');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[db] erro no cliente ocioso:', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id             BIGSERIAL PRIMARY KEY,
  username       TEXT        NOT NULL,
  username_lower TEXT        NOT NULL UNIQUE,
  password_hash  TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS characters (
  id             BIGSERIAL PRIMARY KEY,
  account_id     BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  nickname       TEXT        NOT NULL,
  nickname_lower TEXT        NOT NULL UNIQUE,
  class_id       TEXT        NOT NULL,
  level          INT         NOT NULL DEFAULT 1,
  xp             INT         NOT NULL DEFAULT 0,
  gold           INT         NOT NULL DEFAULT 60,
  hp             INT         NOT NULL,
  mp             INT         NOT NULL,
  map            TEXT        NOT NULL DEFAULT 'over',
  tx             INT         NOT NULL DEFAULT 14,
  ty             INT         NOT NULL DEFAULT 27,
  inventory      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  equipment      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  quest          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_played_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS characters_account_idx ON characters (account_id);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT        PRIMARY KEY,
  account_id BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
`;

export async function migrate() {
  await pool.query(SCHEMA);
  // Sessões vencidas não servem para nada; limpa no boot.
  const { rowCount } = await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  console.log(`[db] schema aplicado; ${rowCount} sessão(ões) vencida(s) removida(s)`);
}

export async function close() {
  await pool.end();
}
