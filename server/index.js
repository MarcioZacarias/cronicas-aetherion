// Ponto de entrada: HTTP para a API e WebSocket para o jogo.
// O nginx serve os estáticos e faz proxy de /api e /ws para cá.

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { migrate, query, close as closeDb } from './db.js';
import { handleApi, parseCookies, clientIp } from './api.js';
import { readSession, SESSION_COOKIE } from './auth.js';
import { Game } from './game.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

await migrate();

const game = new Game();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      console.error('[http] erro não tratado:', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Erro interno' }));
    });
    return;
  }
  // Estáticos são do nginx; se algo chegar aqui, é rota errada.
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Não encontrado' }));
});

// ---------------------------------------------------------
// WebSocket
// ---------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  const recusar = (code, motivo) => {
    socket.write(`HTTP/1.1 ${code} ${motivo}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws') return recusar(404, 'Not Found');

    // A sessão vem do mesmo cookie da API: o WebSocket não é uma porta
    // dos fundos sem autenticação.
    const token = parseCookies(req)[SESSION_COOKIE];
    const sess = await readSession(token);
    if (!sess) return recusar(401, 'Unauthorized');

    const charId = Number(url.searchParams.get('char'));
    if (!Number.isInteger(charId) || charId <= 0) return recusar(400, 'Bad Request');

    const { rows } = await query(
      'SELECT * FROM characters WHERE id = $1 AND account_id = $2',
      [charId, sess.account_id],
    );
    const char = rows[0];
    if (!char) return recusar(403, 'Forbidden');

    // Uma sessão de jogo por personagem: a segunda derruba a primeira,
    // senão dois sockets escrevem no mesmo registro e o save fica incoerente.
    const jaOnline = game.players.get(String(char.id));
    if (jaOnline) {
      try { jaOnline.ws && jaOnline.ws.close(4001, 'conectado em outro lugar'); } catch { /* ignora */ }
      await game.removePlayer(String(char.id));
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      aceitar(ws, char, clientIp(req));
    });
  } catch (err) {
    console.error('[ws] erro no upgrade:', err);
    recusar(500, 'Internal Server Error');
  }
});

function aceitar(ws, char, ip) {
  const p = game.addPlayer(char, ws);
  console.log(`[ws] ${p.nick} (${p.classId} nv${p.level}) entrou de ${ip}`);

  game.sendMap(p);
  p.dirty = true;
  game.sendTo(p, game.snapshotFor(p.map));
  game.broadcastMap(p.map, { t: 'joined', nick: p.nick }, p.charId);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    if (raw.length > 4096) return;
    let msg;
    try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      game.command(p, msg);
    } catch (err) {
      console.error('[ws] comando falhou', msg.t, '-', err.message);
    }
  });

  ws.on('close', () => {
    console.log(`[ws] ${p.nick} saiu`);
    game.removePlayer(p.charId).catch((e) => console.error('[ws] erro ao sair:', e.message));
  });

  ws.on('error', (err) => console.error('[ws] socket de', p.nick, '-', err.message));
}

// Conexão morta sem FIN (celular que perde sinal) só é detectada com ping.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignora */ }
  }
}, 30_000);

// ---------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------
server.listen(PORT, HOST, () => {
  console.log(`[http] Aetherion ouvindo em http://${HOST}:${PORT}`);
});

let encerrando = false;
async function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  console.log(`[app] ${sinal} recebido, salvando personagens...`);
  clearInterval(heartbeat);
  game.stop();
  try { await game.saveAll(); } catch (e) { console.error('[app] falha no save final:', e.message); }
  for (const ws of wss.clients) { try { ws.close(1001, 'servidor reiniciando'); } catch { /* ignora */ } }
  server.close();
  await closeDb().catch(() => {});
  console.log('[app] encerrado.');
  process.exit(0);
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('unhandledRejection', (err) => console.error('[app] promise rejeitada:', err));
