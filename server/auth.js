// Contas, senhas e sessões.
//
// A senha é derivada com scrypt do módulo `node:crypto` — sem dependência
// nativa para compilar no servidor, e é um KDF com custo de memória,
// diferente de um hash simples.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db.js';

const scrypt = promisify(scryptCb);

// N=2^15 custa ~100ms e ~32MB por verificação: caro para quem ataca em
// lote, imperceptível para quem faz login.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 30;

export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(plain, stored) {
  try {
    const [alg, n, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const N = Number(n), R = Number(r), P = Number(p);
    const key = await scrypt(plain, salt, expected.length, {
      N, r: R, p: P, maxmem: 128 * N * R * 2,
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------
// Validação de entrada
// ---------------------------------------------------------
const RE_USER = /^[a-zA-Z0-9_]{3,20}$/;
// Nicks aceitam acento (é um jogo em português) mas nada de espaço nas
// pontas nem duplo espaço, para não existirem dois nicks "iguais na tela".
const RE_NICK = /^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u;

export function validateUsername(u) {
  if (typeof u !== 'string' || !RE_USER.test(u)) {
    return 'Usuário deve ter 3 a 20 caracteres: letras, números ou _';
  }
  return null;
}

export function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8) return 'A senha precisa de pelo menos 8 caracteres';
  if (p.length > 200) return 'Senha longa demais';
  return null;
}

export function validateNickname(n) {
  if (typeof n !== 'string') return 'Nome inválido';
  const t = n.trim();
  if (t.length < 3 || t.length > 16) return 'O nome do personagem precisa ter de 3 a 16 caracteres';
  if (!RE_NICK.test(t)) return 'Use apenas letras e números, separados por no máximo um espaço';
  return null;
}

// ---------------------------------------------------------
// Sessões
// ---------------------------------------------------------
export function newToken() {
  return randomBytes(32).toString('base64url');
}

export async function createSession(accountId) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await query(
    'INSERT INTO sessions (token, account_id, expires_at) VALUES ($1, $2, $3)',
    [token, accountId, expires],
  );
  return { token, expires };
}

export async function readSession(token) {
  if (!token) return null;
  const { rows } = await query(
    `SELECT s.account_id, a.username
       FROM sessions s
       JOIN accounts a ON a.id = s.account_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return rows[0] || null;
}

export async function destroySession(token) {
  if (!token) return;
  await query('DELETE FROM sessions WHERE token = $1', [token]);
}

export const SESSION_COOKIE = 'aeth_sess';
export const SESSION_MAX_AGE = SESSION_DAYS * 86400;
