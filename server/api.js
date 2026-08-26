// API HTTP: contas e personagens.
//
// O nginx serve os estáticos e faz proxy só de /api e /ws para cá, então
// este módulo não precisa servir arquivos.

import { query, pool } from './db.js';
import {
  hashPassword, verifyPassword, createSession, readSession, destroySession,
  validateUsername, validatePassword, validateNickname,
  SESSION_COOKIE, SESSION_MAX_AGE,
} from './auth.js';
import { CLASSES, CLASS_IDS, baseStats } from '../public/shared/content.js';

const MAX_CHARACTERS = 4;
const MAX_BODY = 8 * 1024;

// ---------------------------------------------------------
// Limitador de tentativas — por IP, em memória.
// Não substitui um fail2ban, mas tira do ar o ataque de dicionário
// trivial contra /api/login sem depender de infra extra.
// ---------------------------------------------------------
const attempts = new Map(); // ip -> { count, resetAt }
const LIMIT = { max: 12, windowMs: 10 * 60_000 };

function rateLimited(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + LIMIT.windowMs });
    return false;
  }
  rec.count += 1;
  return rec.count > LIMIT.max;
}

function clearLimit(ip) { attempts.delete(ip); }

// Sem isso o Map cresce sem limite com IPs que nunca voltam.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of attempts) if (now > rec.resetAt) attempts.delete(ip);
}, 5 * 60_000).unref();

// ---------------------------------------------------------
// Utilidades de request/response
// ---------------------------------------------------------
export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'desconhecido';
}

export function parseCookies(req) {
  const raw = req.headers.cookie;
  const out = {};
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(token, maxAge) {
  const bits = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  // Sem HTTPS o navegador descarta um cookie Secure e o login "não funciona".
  if (process.env.NODE_ENV === 'production') bits.push('Secure');
  return bits.join('; ');
}

function send(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('corpo grande demais')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------
// Personagens
// ---------------------------------------------------------
function characterRow(c) {
  return {
    id: String(c.id),
    nickname: c.nickname,
    classId: c.class_id,
    level: c.level,
    xp: c.xp,
    gold: c.gold,
    hp: c.hp,
    mp: c.mp,
    map: c.map,
    lastPlayedAt: c.last_played_at,
  };
}

async function listCharacters(accountId) {
  const { rows } = await query(
    `SELECT * FROM characters WHERE account_id = $1 ORDER BY created_at ASC`,
    [accountId],
  );
  return rows.map(characterRow);
}

// ---------------------------------------------------------
// Roteador
// ---------------------------------------------------------
export async function handleApi(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  try {
    if (path === '/api/register' && method === 'POST') return await register(req, res);
    if (path === '/api/login' && method === 'POST') return await login(req, res);
    if (path === '/api/logout' && method === 'POST') return await logout(req, res);
    if (path === '/api/me' && method === 'GET') return await me(req, res);
    if (path === '/api/characters' && method === 'POST') return await createCharacter(req, res);
    if (path.startsWith('/api/characters/') && method === 'DELETE') {
      return await deleteCharacter(req, res, path.slice('/api/characters/'.length));
    }
    if (path === '/api/health' && method === 'GET') {
      await query('SELECT 1');
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Rota não encontrada' });
  } catch (err) {
    if (err && err.message === 'JSON inválido') return send(res, 400, { error: err.message });
    if (err && err.message === 'corpo grande demais') return send(res, 413, { error: err.message });
    console.error('[api] erro em', method, path, '-', err);
    return send(res, 500, { error: 'Erro interno' });
  }
}

async function currentAccount(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  const sess = await readSession(token);
  return sess ? { id: sess.account_id, username: sess.username, token } : null;
}

async function register(req, res) {
  const ip = clientIp(req);
  if (rateLimited(ip)) return send(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });

  const body = await readBody(req);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = body.password;

  const uErr = validateUsername(username);
  if (uErr) return send(res, 400, { error: uErr });
  const pErr = validatePassword(password);
  if (pErr) return send(res, 400, { error: pErr });

  const hash = await hashPassword(password);
  let accountId;
  try {
    const { rows } = await query(
      `INSERT INTO accounts (username, username_lower, password_hash)
       VALUES ($1, lower($1), $2) RETURNING id`,
      [username, hash],
    );
    accountId = rows[0].id;
  } catch (err) {
    if (err.code === '23505') return send(res, 409, { error: 'Esse usuário já existe' });
    throw err;
  }

  clearLimit(ip);
  const { token } = await createSession(accountId);
  return send(res, 201, { username, characters: [] },
    { 'Set-Cookie': sessionCookie(token, SESSION_MAX_AGE) });
}

async function login(req, res) {
  const ip = clientIp(req);
  if (rateLimited(ip)) return send(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });

  const body = await readBody(req);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const { rows } = await query(
    'SELECT id, username, password_hash FROM accounts WHERE username_lower = lower($1)',
    [username],
  );
  const acc = rows[0];

  // Mesmo sem a conta existir, gastamos o tempo de uma verificação: senão o
  // tempo de resposta revela quais usuários existem.
  const ok = acc
    ? await verifyPassword(password, acc.password_hash)
    : await verifyPassword(password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');

  if (!acc || !ok) return send(res, 401, { error: 'Usuário ou senha incorretos' });

  clearLimit(ip);
  await query('UPDATE accounts SET last_login_at = now() WHERE id = $1', [acc.id]);
  const { token } = await createSession(acc.id);
  const characters = await listCharacters(acc.id);
  return send(res, 200, { username: acc.username, characters },
    { 'Set-Cookie': sessionCookie(token, SESSION_MAX_AGE) });
}

async function logout(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  await destroySession(token);
  return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
}

async function me(req, res) {
  const acc = await currentAccount(req);
  if (!acc) return send(res, 401, { error: 'Não autenticado' });
  const characters = await listCharacters(acc.id);
  return send(res, 200, { username: acc.username, characters });
}

async function createCharacter(req, res) {
  const acc = await currentAccount(req);
  if (!acc) return send(res, 401, { error: 'Não autenticado' });

  const body = await readBody(req);
  const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
  const classId = body.classId;

  const nErr = validateNickname(nickname);
  if (nErr) return send(res, 400, { error: nErr });
  if (!CLASS_IDS.includes(classId)) return send(res, 400, { error: 'Classe inválida' });

  const { rows: countRows } = await query(
    'SELECT count(*)::int AS n FROM characters WHERE account_id = $1', [acc.id],
  );
  if (countRows[0].n >= MAX_CHARACTERS) {
    return send(res, 409, { error: `Limite de ${MAX_CHARACTERS} personagens por conta` });
  }

  const cls = CLASSES[classId];
  const stats = baseStats(classId, 1);
  const equipment = { weapon: cls.start.weapon, shield: null, armor: cls.start.armor, ring: null };
  const inventory = (cls.start.extra || []).map((id) => ({ id, qty: 1 }));

  try {
    const { rows } = await query(
      `INSERT INTO characters
         (account_id, nickname, nickname_lower, class_id, hp, mp, inventory, equipment)
       VALUES ($1, $2, lower($2), $3, $4, $5, $6::jsonb, $7::jsonb)
       RETURNING *`,
      [acc.id, nickname, classId, stats.hpMax, stats.mpMax,
       JSON.stringify(inventory), JSON.stringify(equipment)],
    );
    return send(res, 201, { character: characterRow(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return send(res, 409, { error: 'Já existe um personagem com esse nome' });
    throw err;
  }
}

async function deleteCharacter(req, res, rawId) {
  const acc = await currentAccount(req);
  if (!acc) return send(res, 401, { error: 'Não autenticado' });

  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return send(res, 400, { error: 'Id inválido' });

  const { rowCount } = await query(
    'DELETE FROM characters WHERE id = $1 AND account_id = $2', [id, acc.id],
  );
  if (!rowCount) return send(res, 404, { error: 'Personagem não encontrado' });
  return send(res, 200, { ok: true });
}

export { send, readBody, currentAccount, listCharacters, MAX_CHARACTERS, pool };
