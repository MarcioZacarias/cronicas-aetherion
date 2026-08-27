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

-- O banco é da CONTA, não do personagem: permite mover ouro e equipamento
-- entre os heróis do mesmo jogador, que é metade da graça de ter banco.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bank_gold  INT   NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bank_items JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Templo registrado pelo personagem; nulo = usa o templo da região.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS home JSONB;

-- O mapa da ilha cresceu 15 linhas no topo (zona do castelo): o ponto de
-- nascimento padrão desce junto. Idempotente.
ALTER TABLE characters ALTER COLUMN ty SET DEFAULT 42;

-- Registro dos passos de DADOS que não são idempotentes por natureza:
-- um UPDATE que desloca posições salvas rodaria de novo a cada boot e
-- deslocaria de novo. Cada passo roda uma única vez (ver umaVez()).
CREATE TABLE IF NOT EXISTS migrations (
  name       TEXT        PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// Roda `passos` exatamente uma vez, em transação: o INSERT registra o nome
// e, se ele já existia, nada roda. Se `passos` falhar, o registro também é
// desfeito e o próximo boot tenta de novo.
async function umaVez(nome, passos) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      'INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [nome],
    );
    if (rowCount) await passos(client);
    await client.query('COMMIT');
    return rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function migrate() {
  await pool.query(SCHEMA);

  // O transplante do castelo desceu todo o conteúdo da ilha 15 linhas.
  // Três dados salvos guardam posição absoluta e descem junto: a posição
  // do personagem no over; o templo registrado (home) no over; e quem
  // estava no exterior do castelo — mapa extinto, entrar nele quebraria
  // o tick do servidor — vai para a frente do portão.
  const migrou = await umaVez('2026-08-27-transplante-castelo', async (c) => {
    await c.query(`UPDATE characters SET ty = ty + 15 WHERE map = 'over'`);
    await c.query(`UPDATE characters
                      SET home = jsonb_set(home, '{y}', to_jsonb((home->>'y')::int + 15))
                    WHERE home->>'map' = 'over'`);
    await c.query(`UPDATE characters SET map = 'over', tx = 20, ty = 14 WHERE map = 'castelo'`);
  });
  if (migrou) console.log('[db] transplante do castelo: posições salvas deslocadas 15 linhas');

  // Sessões vencidas não servem para nada; limpa no boot.
  const { rowCount } = await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  console.log(`[db] schema aplicado; ${rowCount} sessão(ões) vencida(s) removida(s)`);
}

export async function close() {
  await pool.end();
}
