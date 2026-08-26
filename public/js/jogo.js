// =========================================================
// Cliente do jogo.
//
// Ele NÃO simula nada: desenha o que o servidor manda e envia intenção.
// A única coisa que inventa é a interpolação — o servidor manda posição em
// tiles a 10 Hz, e aqui isso vira movimento contínuo a 60 fps.
// =========================================================

import { buildWorld, TILE, BLOCK } from '/shared/world.js';
import {
  CLASSES, ITEMS, MSPR, NPCS, SHOPS, BANCARIOS, ESTACOES, DESTINOS, xpNeeded,
} from '/shared/content.js';

const $ = (id) => document.getElementById(id);
const charId = new URLSearchParams(location.search).get('char');

if (!charId) location.href = '/personagens.html';

// ---------------------------------------------------------
// Mundo
// Declarado antes do canvas porque o cálculo de zoom depende do tamanho
// do mapa atual, e o primeiro resize() roda na carga do módulo.
// ---------------------------------------------------------
const MAPS = buildWorld();
let mapaAtual = 'over';

// ---------------------------------------------------------
// Canvas
// ---------------------------------------------------------
const canvas = $('game');
const ctx = canvas.getContext('2d');
let ZOOM = 2;

// Escala só em números inteiros: em 2.5x o pixel art fica com linhas de
// espessura desigual e a arte "treme" ao andar.
const ZOOM_MAX = 4;

// Quantos tiles cabem na menor dimensão da tela. O Tibia clássico mostra
// 11 na vertical; 16 dá um campo de visão parecido com folga para telas
// largas. Aumentar este número deixa tudo MENOR.
const TILES_NA_TELA = 16;

let zoomManual = 0; // 0 = automático
try {
  zoomManual = Number(localStorage.getItem('aeth_zoom')) || 0;
} catch { zoomManual = 0; } // navegador com storage bloqueado

const ZOOM_MIN = 1;

function zoomAutomatico() {
  const desejado = Math.round(Math.min(canvas.width, canvas.height) / (TILE * TILES_NA_TELA));
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, desejado));
}

function aplicarZoom() {
  ZOOM = zoomManual ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomManual)) : zoomAutomatico();
  const el = $('zoomlvl');
  if (el) el.textContent = `${ZOOM}x${zoomManual ? '' : ' auto'}`;
}

function mudarZoom(delta) {
  const atual = ZOOM;
  const novo = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, atual + delta));
  if (novo === atual) return;
  // Voltar ao valor que o automático escolheria significa "deixe automático",
  // para a preferência não congelar quando a tela mudar de tamanho.
  zoomManual = novo === zoomAutomatico() ? 0 : novo;
  try { localStorage.setItem('aeth_zoom', String(zoomManual)); } catch { /* sem storage */ }
  aplicarZoom();
}

function resize() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  aplicarZoom();
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------
// Sprites
// ---------------------------------------------------------
const SPRITES = ['soldier', 'guard', 'princess', 'villager', 'slime', 'bat', 'snake', 'bee',
  'sworm', 'bworm', 'eyeball', 'ghost', 'pumpking', 'grass', 'dirt', 'dirt2', 'water', 'tree',
  'chest', 'house', 'hole', 'wall', 'rock', 'house2', 'chapel', 'grave', 'wasp', 'zombie',
  'cultist', 'priest', 'boat', 'flower', 'city',
  // Variantes vestidas geradas por tools/vestir-npcs.py — o pacote LPC
  // incluído traz só o corpo, sem as camadas de cabelo e roupa.
  'villager_a', 'villager_b', 'villager_c', 'guard_a', 'guard_b', 'soldier_a',
  'princess_a', 'princess_b', 'princess_c', 'lpc-sets', 'roof', 'lpc-props'];
const IMG = {};

// Índices dos atlas: city.png (portas/janelas recortadas das fachadas) e
// lpc-sets.png (telhados, calçamento e alvenaria importados dos pacotes LPC
// como fatias de 9 — ver tools/importar-lpc.py).
let CITY = null;
let SETS = null;
let TELHADOS = null;
let PROPS = null;

function carregarSprites() {
  const imagens = SPRITES.map((nome) => new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve();
    // Um sprite que falha não pode travar o jogo inteiro; ele só não desenha.
    im.onerror = () => { console.warn('sprite ausente:', nome); resolve(); };
    im.src = `/assets/${nome}.png`;
    IMG[nome] = im;
  }));
  const indice = fetch('/assets/city.json')
    .then((r) => r.json())
    .then((j) => { CITY = j; })
    .catch(() => { console.warn('city.json ausente: prédios não serão desenhados'); });
  const telhados = fetch('/assets/lpc-sets.json')
    .then((r) => r.json())
    .then((j) => { SETS = j; })
    .catch(() => { console.warn('lpc-sets.json ausente: telhados e calçamento não serão desenhados'); });
  const catTelhados = fetch('/assets/roof.json')
    .then((r) => r.json())
    .then((j) => { TELHADOS = j; })
    .catch(() => { console.warn('roof.json ausente: telhados não serão desenhados'); });
  const catProps = fetch('/assets/lpc-props.json')
    .then((r) => r.json())
    .then((j) => { PROPS = j; })
    .catch(() => { console.warn('lpc-props.json ausente: mobiliário volta ao desenho procedural'); });
  return Promise.all([...imagens, indice, telhados, catTelhados, catProps]);
}

// ---------------------------------------------------------
// Estado
// ---------------------------------------------------------
let eu = null;                 // estado privado vindo de 'you'
let meuId = null;
const ents = new Map();        // id -> entidade interpolada
let dest = null;               // marcador do click-to-move
let alvo = null;               // id do monstro atacado
let recargaMagia = 0;          // espelho local do cooldown que o servidor informa
let floats = [], effects = [], bolhas = new Map();
const cam = { x: 0, y: 0 };
let waterFrame = 0, waterT = 0, pulse = 0;

function entidade(id, dados) {
  let e = ents.get(id);
  if (!e) {
    e = { id, px: dados.x * TILE, py: dados.y * TILE, frame: 0, ftime: 0 };
    ents.set(id, e);
  }
  Object.assign(e, dados, { visto: true });
  return e;
}

// ---------------------------------------------------------
// Rede
// ---------------------------------------------------------
let ws = null, tentativas = 0, fechandoDeProposito = false;

function conectar() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws?char=${encodeURIComponent(charId)}`);

  ws.onopen = () => {
    tentativas = 0;
    conexaoStatus('online', '');
    esconderAviso();
  };

  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    receber(m);
  };

  ws.onclose = (ev) => {
    if (fechandoDeProposito) return;
    // 4001 = o servidor derrubou esta sessão porque o personagem entrou
    // em outro lugar. Reconectar aqui só faria as duas abas brigarem.
    if (ev.code === 4001) {
      return mostrarAviso('Sessão encerrada',
        'Este personagem entrou no jogo em outra aba ou dispositivo.',
        [['Voltar aos personagens', '/personagens.html']]);
    }
    if (ev.code === 4401 || ev.code === 1008) {
      return mostrarAviso('Sessão expirada', 'Faça login novamente.', [['Entrar', '/entrar.html']]);
    }
    conexaoStatus('caiu', 'reconectando...');
    tentativas += 1;
    if (tentativas > 8) {
      return mostrarAviso('Sem conexão',
        'Não foi possível falar com o servidor. Verifique sua internet.',
        [['Tentar de novo', location.href], ['Personagens', '/personagens.html']]);
    }
    // Recuo exponencial com teto: não martelar um servidor que caiu.
    setTimeout(conectar, Math.min(8000, 500 * 2 ** tentativas));
  };

  ws.onerror = () => conexaoStatus('ruim', 'instável');
}

function enviar(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function conexaoStatus(classe, texto) {
  const el = $('conexao');
  el.className = classe === 'online' ? '' : classe;
  el.textContent = texto || (classe === 'online' ? 'online' : classe);
}

function receber(m) {
  switch (m.t) {
    case 'map': {
      mapaAtual = m.map;
      // Ao trocar de mapa, nada do mapa antigo vale mais.
      ents.clear(); floats = []; effects = []; bolhas.clear();
      dest = null; alvo = null;
      break;
    }
    case 'you': {
      eu = m; meuId = m.id;
      recargaMagia = m.spellCd || 0;
      pintarHud();
      if ($('inv').classList.contains('open')) pintarInventario();
      if ($('shop').classList.contains('open')) pintarLoja();
      if ($('banco').classList.contains('open')) pintarBanco();
      break;
    }
    case 'banco': {
      cofre = { gold: m.gold, items: m.items || [] };
      if ($('banco').classList.contains('open')) pintarBanco();
      break;
    }
    case 'snap': {
      for (const e of ents.values()) e.visto = false;
      for (const p of m.players) entidade(p.id, { ...p, tipo: 'jogador' });
      for (const mo of m.monsters) entidade(mo.id, { ...mo, tipo: 'monstro' });
      for (const [id, e] of ents) if (!e.visto) ents.delete(id);
      if (alvo && !ents.has(alvo)) alvo = null;
      $('online').textContent = m.players.length > 1
        ? `${m.players.length} jogadores neste mapa` : '';
      break;
    }
    case 'log': registrar(m.text); break;
    case 'chat': {
      addChat(m.from, m.text);
      bolhas.set(m.id, { texto: m.text, ate: performance.now() + 5000 });
      break;
    }
    case 'joined': registrar(`${m.nick} entrou no mapa.`); break;
    case 'kill': if (m.by) registrar(`${m.by} derrotou ${m.name}.`); break;
    case 'died': if (m.id !== meuId) registrar(`${m.nick} tombou.`); break;
    case 'chest': break;
    case 'fx': efeito(m); break;
    default: break;
  }
}

// ---------------------------------------------------------
// Efeitos visuais vindos do servidor
// ---------------------------------------------------------
function efeito(m) {
  const cx = m.x * TILE + 16, cy = m.y * TILE + 16;
  switch (m.kind) {
    case 'dmg': flutuar(m.x, m.y, `-${m.amount}`, '#ff4444'); break;
    case 'hit': flutuar(m.x, m.y, `-${m.amount}`, '#ff8844'); break;
    case 'heal': flutuar(m.x, m.y, `+${m.amount}`, '#7dd87d'); break;
    case 'xp': if (m.to === meuId) flutuar(m.x, m.y, `+${m.amount} XP`, '#a08cf0'); break;
    case 'levelup': flutuar(m.x, m.y, 'LEVEL UP!', '#ffe066'); break;
    case 'slash': effects.push({ tipo: 'slash', x: cx, y: cy, life: 220, max: 220 }); break;
    case 'aoe': effects.push({ tipo: 'aoe', x: cx, y: cy, life: 500, max: 500 }); break;
    case 'bolt':
    case 'shot':
      effects.push({
        tipo: m.kind, x: cx, y: cy,
        x2: m.tx * TILE + 16, y2: m.ty * TILE + 16, life: 260, max: 260,
      });
      break;
    default: break;
  }
}

function flutuar(tx, ty, txt, cor) {
  floats.push({ x: tx * TILE + 16, y: ty * TILE, txt, cor, life: 1200 });
}

// ---------------------------------------------------------
// HUD
// ---------------------------------------------------------
function registrar(texto) { $('log').textContent = texto; }

function addChat(quem, texto) {
  const log = $('chatlog');
  const d = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = `${quem}: `;
  d.appendChild(b);
  d.appendChild(document.createTextNode(texto));
  log.appendChild(d);
  while (log.children.length > 8) log.removeChild(log.firstChild);
}

function pintarHud() {
  if (!eu) return;
  const cls = CLASSES[eu.cls];
  $('nick').textContent = `${cls ? cls.icon : ''} ${eu.nick}`;
  $('lvl').textContent = eu.level;
  $('hpbar').style.width = `${Math.max(0, 100 * eu.hp / eu.hpMax)}%`;
  $('hptxt').textContent = `${eu.hp}/${eu.hpMax}`;
  $('mpbar').style.width = `${Math.max(0, 100 * eu.mp / eu.mpMax)}%`;
  $('mptxt').textContent = `${eu.mp}/${eu.mpMax}`;
  const need = eu.xpNext, prev = xpNeeded(eu.level - 1) || 0;
  $('xpbar').style.width = `${Math.max(0, Math.min(100, 100 * (eu.xp - prev) / (need - prev)))}%`;
  $('xptxt').textContent = `XP ${eu.xp}`;
  $('gold').textContent = eu.gold;
  if (cls) $('spellcost').textContent = `${cls.spell.cost} MP`;
}

// ---------------------------------------------------------
// Aviso de tela cheia
// ---------------------------------------------------------
function mostrarAviso(titulo, texto, acoes = []) {
  $('avisoTitulo').textContent = titulo;
  $('avisoTexto').textContent = texto;
  const box = $('avisoAcoes');
  box.innerHTML = '';
  for (const [rotulo, href] of acoes) {
    const a = document.createElement('a');
    a.textContent = rotulo;
    a.href = href;
    box.appendChild(a);
  }
  $('aviso').style.display = 'flex';
}
function esconderAviso() { $('aviso').style.display = 'none'; }

// ---------------------------------------------------------
// Inventário
// ---------------------------------------------------------
function pintarInventario() {
  if (!eu) return;
  for (const el of document.querySelectorAll('.eqslot')) {
    const id = eu.eq[el.dataset.slot];
    const it = id && ITEMS[id];
    el.querySelector('span').textContent = it ? `${it.icon} ${it.name}` : '—';
  }
  const grid = $('grid');
  grid.innerHTML = '';
  eu.inv.forEach((slot, i) => {
    const it = ITEMS[slot.id];
    if (!it) return;
    const div = document.createElement('div');
    div.className = 'slot';
    div.innerHTML = `<div>${it.icon}</div><small></small>${slot.qty > 1 ? `<span class="qty">${slot.qty}</span>` : ''}`;
    div.querySelector('small').textContent = it.name;
    div.onclick = () => enviar({ t: 'use', idx: i });
    grid.appendChild(div);
  });
  for (let i = eu.inv.length; i < 12; i++) {
    const div = document.createElement('div');
    div.className = 'slot';
    grid.appendChild(div);
  }
  const cls = CLASSES[eu.cls];
  $('stats').innerHTML = '';
  const linhas = [
    `Classe: ${cls.name} — ${cls.tagline}`,
    `Ataque ${eu.atk} · Defesa ${eu.def} · Alcance ${cls.range === 1 ? 'corpo a corpo' : `${cls.range} tiles`}`,
    `Magia: ${cls.spell.name} (${cls.spell.cost} MP) — ${cls.spell.desc}`,
    'Toque num item para usar ou equipar; no slot equipado para tirar.',
  ];
  for (const l of linhas) {
    const p = document.createElement('div');
    p.textContent = l;
    $('stats').appendChild(p);
  }
}

for (const el of document.querySelectorAll('.eqslot')) {
  el.onclick = () => enviar({ t: 'unequip', slot: el.dataset.slot });
}

// ---------------------------------------------------------
// Loja
// ---------------------------------------------------------
let lojaAtual = null;

function abrirLoja(npcId) {
  lojaAtual = npcId;
  const npc = NPCS.find((n) => n.id === npcId);
  $('shopname').textContent = npc ? npc.name : 'Loja';
  pintarLoja();
  $('shop').classList.add('open');
}

function pintarLoja() {
  if (!lojaAtual || !eu) return;
  $('shopgold').textContent = `Seu ouro: ${eu.gold}`;
  const rows = $('shoprows');
  rows.innerHTML = '';
  for (const id of SHOPS[lojaAtual] || []) {
    const it = ITEMS[id];
    const div = document.createElement('div');
    div.className = 'shoprow';
    div.innerHTML = `<span class="ic">${it.icon}</span><span class="nm"></span><button></button>`;
    div.querySelector('.nm').textContent = it.name;
    const b = div.querySelector('button');
    b.textContent = `${it.price} 💰`;
    b.disabled = eu.gold < it.price;
    b.onclick = () => enviar({ t: 'buy', npc: lojaAtual, item: id });
    rows.appendChild(div);
  }
}

// ---------------------------------------------------------
// Entrada do jogador
// ---------------------------------------------------------
function meuEnt() { return meuId ? ents.get(meuId) : null; }

// Índice de mobiliário por tile, refeito só quando o mapa muda.
let propIndex = null, propIndexMapa = null;
function indiceProps() {
  if (propIndexMapa === mapaAtual && propIndex) return propIndex;
  propIndex = new Map();
  for (const p of MAPS[mapaAtual].props || []) propIndex.set(`${p.x},${p.y}`, p);
  propIndexMapa = mapaAtual;
  return propIndex;
}

canvas.addEventListener('pointerdown', (ev) => {
  const me = meuEnt();
  if (!me) return;
  const tx = Math.floor((cam.x + ev.clientX / ZOOM) / TILE);
  const ty = Math.floor((cam.y + ev.clientY / ZOOM) / TILE);
  const M = MAPS[mapaAtual];
  if (tx < 0 || ty < 0 || tx >= M.w || ty >= M.h) return;

  // Prioridade do toque: monstro > NPC > cenário interativo > andar.
  const mob = [...ents.values()].find((e) => e.tipo === 'monstro' && e.x === tx && e.y === ty);
  if (mob) { alvo = mob.id; enviar({ t: 'attack', id: mob.id }); return; }

  const npc = NPCS.find((n) => n.map === mapaAtual && n.x === tx && n.y === ty);
  if (npc) return tocarNpc(npc, me);

  const tile = M.tiles[ty][tx];
  if ((tile === 4 || tile === 10) && Math.abs(tx - me.x) <= 1 && Math.abs(ty - me.y) <= 1) {
    return enviar({ t: 'interact', x: tx, y: ty });
  }
  if (BLOCK.has(tile)) {
    // Clicar numa parede não deve mover: dá o retorno e para por aí.
    if (tile === 4 || tile === 10) registrar('Chegue mais perto para interagir.');
    return;
  }
  dest = { x: tx, y: ty };
  alvo = null;
  enviar({ t: 'go', x: tx, y: ty });
});

function tocarNpc(npc, me) {
  if (Math.abs(npc.x - me.x) > 2 || Math.abs(npc.y - me.y) > 2) {
    dest = { x: npc.x, y: npc.y };
    enviar({ t: 'go', x: npc.x, y: npc.y });
    registrar(`Indo falar com ${npc.name.split(' ')[0]}...`);
    return;
  }
  if (SHOPS[npc.id]) return abrirLoja(npc.id);
  if (BANCARIOS.includes(npc.id)) return abrirBanco(npc);
  if (ESTACOES[npc.id]) return abrirViagem(npc);
  registrar(`${npc.name}: "Que os ventos lhe sejam bons, viajante."`);
}

// ---------------------------------------------------------
// Banco
// ---------------------------------------------------------
let cofre = null; // { gold, items } — o que o servidor diz que há na conta

function abrirBanco(npc) {
  $('banconame').textContent = npc.name;
  cofre = null;
  pintarBanco();
  $('banco').classList.add('open');
  enviar({ t: 'banco', acao: 'consultar' });
}

function pintarBanco() {
  if (!eu) return;
  $('bancosaldo').textContent = cofre
    ? `No cofre: ${cofre.gold} 💰   ·   Com você: ${eu.gold} 💰`
    : 'Consultando o caixa...';

  const lista = $('bancoitens');
  lista.innerHTML = '';
  if (!cofre) return;

  if (!cofre.items.length) {
    const v = document.createElement('div');
    v.style.cssText = 'font-size:11px;color:#8a7a5a;padding:8px 0';
    v.textContent = 'O cofre está vazio.';
    lista.appendChild(v);
  }
  cofre.items.forEach((slot, i) => {
    const it = ITEMS[slot.id];
    if (!it) return;
    const linha = document.createElement('div');
    linha.className = 'shoprow';
    linha.innerHTML = `<span class="ic">${it.icon}</span><span class="nm"></span><button>Retirar</button>`;
    linha.querySelector('.nm').textContent = it.name + (slot.qty > 1 ? ` ×${slot.qty}` : '');
    linha.querySelector('button').onclick = () => enviar({ t: 'banco', acao: 'retirar', idx: i });
    lista.appendChild(linha);
  });

  const daMochila = $('bancomochila');
  daMochila.innerHTML = '';
  eu.inv.forEach((slot, i) => {
    const it = ITEMS[slot.id];
    if (!it) return;
    const linha = document.createElement('div');
    linha.className = 'shoprow';
    linha.innerHTML = `<span class="ic">${it.icon}</span><span class="nm"></span><button>Guardar</button>`;
    linha.querySelector('.nm').textContent = it.name + (slot.qty > 1 ? ` ×${slot.qty}` : '');
    linha.querySelector('button').onclick = () => enviar({ t: 'banco', acao: 'guardar', idx: i });
    daMochila.appendChild(linha);
  });
}

function valorBanco() {
  const v = Math.floor(Number($('bancovalor').value));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// ---------------------------------------------------------
// Viagem
// ---------------------------------------------------------
function abrirViagem(npc) {
  $('viagemname').textContent = npc.name;
  const rotas = ESTACOES[npc.id] || [];
  const lista = $('viagemrotas');
  lista.innerHTML = '';
  for (const id of rotas) {
    const d = DESTINOS[id];
    if (!d) continue;
    const linha = document.createElement('div');
    linha.className = 'shoprow';
    linha.innerHTML = `<span class="ic">🐎</span><span class="nm"></span><button></button>`;
    linha.querySelector('.nm').textContent = d.nome;
    const b = linha.querySelector('button');
    b.textContent = `${d.preco} 💰`;
    b.disabled = !eu || eu.gold < d.preco;
    b.onclick = () => { enviar({ t: 'viajar', destino: id }); fecharModais(); };
    lista.appendChild(linha);
  }
  $('viagemouro').textContent = eu ? `Seu ouro: ${eu.gold}` : '';
  $('viagem').classList.add('open');
}

// direcional
const segurando = { up: false, down: false, left: false, right: false };
const VETOR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

for (const b of document.querySelectorAll('#dpad button')) {
  const d = b.dataset.d;
  const liga = (ev) => { ev.preventDefault(); segurando[d] = true; };
  const desliga = () => { segurando[d] = false; };
  b.addEventListener('pointerdown', liga);
  b.addEventListener('pointerup', desliga);
  b.addEventListener('pointerleave', desliga);
  b.addEventListener('pointercancel', desliga);
}

const TECLAS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
};

addEventListener('keydown', (ev) => {
  if (document.activeElement === $('chatin')) {
    if (ev.key === 'Escape') $('chatin').blur();
    return;
  }
  const dir = TECLAS[ev.key];
  if (dir) { segurando[dir] = true; ev.preventDefault(); return; }
  if (ev.key === 'b' || ev.key === 'B') alternarInventario();
  else if (ev.key === 'e' || ev.key === 'E') enviar({ t: 'spell' });
  else if (ev.key === 'Escape') { enviar({ t: 'stop' }); dest = null; alvo = null; fecharModais(); }
  else if (ev.key === 'Enter') { ev.preventDefault(); $('chatin').focus(); }
  else if (ev.key === '+' || ev.key === '=') mudarZoom(1);
  else if (ev.key === '-' || ev.key === '_') mudarZoom(-1);
});

addEventListener('keyup', (ev) => {
  const dir = TECLAS[ev.key];
  if (dir) segurando[dir] = false;
});

// O passo é limitado no cliente só para não inundar o socket; quem decide
// se o passo vale é o servidor.
let ultimoPasso = 0;
function passosSegurados(agora) {
  if (agora - ultimoPasso < 120) return;
  for (const [dir, ativo] of Object.entries(segurando)) {
    if (!ativo) continue;
    const [dx, dy] = VETOR[dir];
    enviar({ t: 'step', dx, dy });
    dest = null; alvo = null;
    ultimoPasso = agora;
    return;
  }
}

// botões
function alternarInventario() {
  const el = $('inv');
  el.classList.toggle('open');
  if (el.classList.contains('open')) pintarInventario();
}
function fecharModais() {
  for (const id of ['inv', 'shop', 'banco', 'viagem']) $(id).classList.remove('open');
  lojaAtual = null;
  cofre = null;
}
$('bagbtn').onclick = alternarInventario;
$('closeinv').onclick = () => $('inv').classList.remove('open');
$('closeshop').onclick = () => { $('shop').classList.remove('open'); lojaAtual = null; };
$('closebanco').onclick = () => { $('banco').classList.remove('open'); cofre = null; };
$('closeviagem').onclick = () => $('viagem').classList.remove('open');
$('bancodep').onclick = () => { const v = valorBanco(); if (v) enviar({ t: 'banco', acao: 'depositar', valor: v }); };
$('bancosac').onclick = () => { const v = valorBanco(); if (v) enviar({ t: 'banco', acao: 'sacar', valor: v }); };
$('bancotudo').onclick = () => { if (eu) $('bancovalor').value = String(eu.gold); };
$('spellbtn').onclick = () => enviar({ t: 'spell' });
$('stopbtn').onclick = () => { enviar({ t: 'stop' }); dest = null; alvo = null; };
$('zoomin').onclick = () => mudarZoom(1);
$('zoomout').onclick = () => mudarZoom(-1);

$('chatform').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const texto = $('chatin').value.trim();
  if (texto) enviar({ t: 'chat', text: texto });
  $('chatin').value = '';
  $('chatin').blur();
});

// ---------------------------------------------------------
// Render
// ---------------------------------------------------------
function ds(img, sx, sy, sw, sh, dx, dy, dw, dh) {
  if (!img || !img.complete || !img.naturalWidth) return;
  ctx.drawImage(img, sx, sy, sw, sh,
    Math.round((dx - cam.x) * ZOOM), Math.round((dy - cam.y) * ZOOM),
    (dw || sw) * ZOOM, (dh || sh) * ZOOM);
}

function barraVida(px, py, hp, hpMax, w, yoff) {
  const pct = Math.max(0, Math.min(1, hp / hpMax));
  const x = (px - cam.x + (TILE - w) / 2) * ZOOM, y = (py - cam.y - yoff) * ZOOM;
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 1, y - 1, w * ZOOM + 2, 3 * ZOOM + 2);
  ctx.fillStyle = pct > 0.6 ? '#4cd04c' : pct > 0.3 ? '#e0c040' : '#e04040';
  ctx.fillRect(x, y, w * ZOOM * pct, 3 * ZOOM);
}

function simboloEclipse(cx, cy, r, alpha) {
  ctx.fillStyle = `rgba(10,10,15,${alpha})`;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  ctx.strokeStyle = `rgba(90,60,150,${alpha})`;
  ctx.lineWidth = ZOOM;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 7;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
}

function nomeRegiao() {
  const me = meuEnt();
  if (!me) return MAPS[mapaAtual].name;
  const { x, y } = me;
  if (mapaAtual === 'mine') {
    if (y >= 16) return 'Minas de Aurora — Galeria Superior';
    if (y >= 9) return 'Minas de Aurora — Poço Profundo';
    if (x <= 13) return 'Minas de Aurora — Câmara do Capataz';
    return 'Minas de Aurora — Ruínas Antigas';
  }
  if (mapaAtual === 'cata') {
    if (y >= 12) return 'Catacumbas — Escadaria da Capela';
    if (y <= 7 && x >= 10 && x <= 19) return 'Catacumbas — Altar do Eclipse';
    if (x <= 9) return 'Catacumbas — Criptas Antigas';
    return 'Catacumbas de Ardentia';
  }
  if (mapaAtual === 'vale') {
    if (x >= 4 && x <= 19 && y >= 4 && y <= 14) return 'Ardentia — Capital de Valedorn';
    if (x >= 33 && y <= 20) return 'Floresta de Elden';
    if (x <= 18 && y >= 20) return 'Cemitério de Ardentia';
    if (x >= 20 && y <= 17) return 'Campos de Valedorn';
    return 'Valedorn';
  }
  if (x >= 6 && x <= 22 && y >= 16 && y <= 27) return 'Vila de Lumera';
  if (x >= 26 && y >= 20) return 'Pântano de Aurora';
  if (y <= 8 && x >= 14 && x <= 23) return 'Entrada das Minas';
  if (x <= 15 && y <= 16) return 'Floresta de Aurora';
  return 'Ilha de Aurora';
}

function temTocha() {
  if (!eu) return false;
  return eu.inv.some((s) => s.id === 'torch') || Object.values(eu.eq).includes('torch');
}

// Interpolação: aproxima px/py do tile autoritativo. 0.128 px/ms é
// exatamente 32px em 250ms, a cadência de passo do servidor.
function interpolar(dt) {
  for (const e of ents.values()) {
    const gx = e.x * TILE, gy = e.y * TILE;
    const vel = 0.128 * dt;
    const andando = e.px !== gx || e.py !== gy;
    if (andando) {
      e.px += Math.sign(gx - e.px) * Math.min(vel, Math.abs(gx - e.px));
      e.py += Math.sign(gy - e.py) * Math.min(vel, Math.abs(gy - e.py));
      e.ftime += dt;
      const passo = e.tipo === 'jogador' ? 110 : 160;
      if (e.ftime > passo) { e.ftime = 0; e.frame = (e.frame + 1) % (e.tipo === 'jogador' ? 8 : 3); }
    } else if (e.tipo === 'jogador') {
      e.frame = 0;
    } else {
      e.ftime += dt;
      if (e.ftime > 300) { e.ftime = 0; e.frame = (e.frame + 1) % 3; }
    }
    // Teleporte ou dessincronização grande: corta direto em vez de deslizar
    // pela tela inteira.
    if (Math.abs(gx - e.px) > TILE * 3 || Math.abs(gy - e.py) > TILE * 3) {
      e.px = gx; e.py = gy;
    }
  }
}

function render(dt) {
  waterT += dt;
  if (waterT > 400) { waterT = 0; waterFrame = (waterFrame + 1) % 3; }
  pulse += dt;

  const M = MAPS[mapaAtual];
  const escuro = !!M.dark;
  const me = meuEnt();
  const vw = canvas.width / ZOOM, vh = canvas.height / ZOOM;
  const foco = me || { px: M.w * TILE / 2, py: M.h * TILE / 2 };

  cam.x = Math.max(0, Math.min(M.w * TILE - vw, foco.px + 16 - vw / 2));
  cam.y = Math.max(0, Math.min(M.h * TILE - vh, foco.py + 16 - vh / 2));
  if (M.w * TILE < vw) cam.x = (M.w * TILE - vw) / 2;
  if (M.h * TILE < vh) cam.y = (M.h * TILE - vh) / 2;

  ctx.fillStyle = '#060606';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Faixa visível SEM prender aos limites do mapa: o que cai fora vira
  // água (ou escuro, nas cavernas). Sem isso, zoom baixo em tela larga
  // deixaria barras pretas em volta de um mapa de 40 tiles.
  const vx0 = Math.floor(cam.x / TILE), vy0 = Math.floor(cam.y / TILE);
  const vx1 = vx0 + Math.ceil(vw / TILE) + 1, vy1 = vy0 + Math.ceil(vh / TILE) + 1;
  const x0 = Math.max(0, vx0), y0 = Math.max(0, vy0);
  const x1 = Math.min(M.w - 1, vx1), y1 = Math.min(M.h - 1, vy1);

  for (let y = vy0; y <= vy1; y++) for (let x = vx0; x <= vx1; x++) {
    const dentro = x >= 0 && y >= 0 && x < M.w && y < M.h;
    if (!dentro) {
      if (!escuro) ds(IMG.water, waterFrame * 32, 160, 32, 32, x * TILE, y * TILE);
      continue;
    }
    const t = M.tiles[y][x], v = M.deco[y][x];
    const bx = (x * TILE - cam.x) * ZOOM, by = (y * TILE - cam.y) * ZOOM, S = TILE * ZOOM;
    if (escuro) {
      if (t === 6 || t === 13) { ds(IMG.wall, 0, 0, 32, 32, x * TILE, y * TILE); continue; }
      if (t === 8) {
        ds(IMG.wall, 0, 0, 32, 32, x * TILE, y * TILE);
        ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx + S * .5, by + S * .1); ctx.lineTo(bx + S * .35, by + S * .45);
        ctx.lineTo(bx + S * .6, by + S * .6); ctx.lineTo(bx + S * .45, by + S * .9);
        ctx.stroke(); continue;
      }
      if (t === 9) {
        ds(IMG.wall, 0, 0, 32, 32, x * TILE, y * TILE);
        simboloEclipse(bx + 16 * ZOOM, by + 16 * ZOOM, 11 * ZOOM, 1); continue;
      }
      if (t === 14) {
        ds(IMG.wall, 0, 0, 32, 32, x * TILE, y * TILE);
        ctx.fillStyle = '#4a3018'; ctx.fillRect(bx + S * .1, by + S * .1, S * .8, S * .8);
        ['#a04040', '#4060a0', '#a0a040', '#40a060'].forEach((c, i) => {
          ctx.fillStyle = c; ctx.fillRect(bx + S * (.16 + i * .18), by + S * .18, S * .12, S * .6);
        });
        continue;
      }
      ds(IMG.dirt, (v % 3) * 32, 160, 32, 32, x * TILE, y * TILE);
      if (t === 7) ds(IMG.rock, 0, 0, 32, 32, x * TILE, y * TILE);
      if (t === 15) ds(IMG.grave, 0, 0, 32, 32, x * TILE, y * TILE);
      if (t === 4) ds(IMG.chest, 0, 0, 32, 32, x * TILE, y * TILE);
      if (t === 11) {
        ctx.fillStyle = 'rgba(240,208,96,.25)'; ctx.fillRect(bx, by, S, S);
        ctx.fillStyle = '#f0d060'; ctx.font = `bold ${10 * ZOOM}px Courier New`;
        ctx.textAlign = 'center'; ctx.fillText('⬆', bx + 16 * ZOOM, by + 22 * ZOOM);
      }
      if (t === 10) {
        const g = 0.6 + 0.4 * Math.sin(pulse / 300);
        const cx = bx + 16 * ZOOM, cy = by + 16 * ZOOM;
        ctx.fillStyle = `rgba(120,60,200,${0.25 * g})`;
        ctx.beginPath(); ctx.arc(cx, cy, 14 * ZOOM * g, 0, 7); ctx.fill();
        ctx.fillStyle = '#9a5cf0';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 8 * ZOOM); ctx.lineTo(cx + 5 * ZOOM, cy);
        ctx.lineTo(cx, cy + 8 * ZOOM); ctx.lineTo(cx - 5 * ZOOM, cy);
        ctx.closePath(); ctx.fill();
      }
    } else {
      if (t === 2) { ds(IMG.water, waterFrame * 32, 160, 32, 32, x * TILE, y * TILE); continue; }
      if (t === 13) { ds(IMG.wall, 0, 0, 32, 32, x * TILE, y * TILE); continue; }

      // Um objeto (19) substituiu o chão que havia ali, então recuperamos o
      // tipo original guardado no prop. Um prédio (17) fica todo coberto
      // pela fachada, então basta um chão neutro por baixo.
      let chao = t;
      if (t === 19) chao = indiceProps().get(`${x},${y}`)?.chao ?? 0;
      else if (t === 17) chao = 1;

      if (chao === 18) {
        desenharCalcamento(x, y, v);
      } else if (!desenharTerreno(M, x, y, familiaTerreno(chao))) {
        // Reserva: sprites chapados de antes, se o atlas não carregou.
        if (chao === 5) ds(IMG.dirt2, (v % 3) * 32, 160, 32, 32, x * TILE, y * TILE);
        else if (chao === 1 || chao === 12) ds(IMG.dirt, (v % 3) * 32, 160, 32, 32, x * TILE, y * TILE);
        else ds(IMG.grass, (v % 3) * 32, 160, 32, 32, x * TILE, y * TILE);
      }

      if (t === 7) ds(IMG.rock, 0, 0, 32, 32, x * TILE, y * TILE);
      if (t === 15) ds(IMG.grave, 0, 0, 32, 32, x * TILE, y * TILE);
      if (t === 4) ds(IMG.chest, 0, 0, 32, 32, x * TILE, y * TILE);
      if (t === 14) {
        ctx.fillStyle = '#4a3018'; ctx.fillRect(bx + S * .05, by, S * .9, S);
        ['#a04040', '#4060a0', '#a0a040', '#40a060'].forEach((c, i) => {
          ctx.fillStyle = c; ctx.fillRect(bx + S * (.12 + i * .19), by + S * .1, S * .13, S * .75);
        });
      }
      if (t === 16) {
        ctx.fillStyle = '#5a3a1a'; ctx.fillRect(bx + S * .44, by + S * .35, S * .12, S * .6);
        ctx.fillStyle = '#8a6034'; ctx.fillRect(bx + S * .1, by + S * .08, S * .8, S * .34);
        ctx.strokeStyle = '#4a3018'; ctx.lineWidth = Math.max(1, ZOOM * .7);
        ctx.strokeRect(bx + S * .1, by + S * .08, S * .8, S * .34);
        ctx.fillStyle = '#3a2810';
        ctx.fillRect(bx + S * .18, by + S * .16, S * .5, S * .05);
        ctx.fillRect(bx + S * .18, by + S * .26, S * .62, S * .05);
      }
    }
  }

  if (mapaAtual === 'over' && M.holeAnchor) {
    ds(IMG.hole, 0, 0, 96, 96, M.holeAnchor.x * TILE, M.holeAnchor.y * TILE);
  }
  if (M.boat) ds(IMG.boat, 0, 0, 64, 40, M.boat.x * TILE - 16, M.boat.y * TILE - 4);
  if (mapaAtual === 'cata' && M.altar) {
    simboloEclipse((M.altar.x * TILE - cam.x + 16) * ZOOM,
      (M.altar.y * TILE - cam.y + 48) * ZOOM, 26 * ZOOM, 0.5);
  }

  // Tudo que tem "pé no chão" entra numa lista ordenada por Y, para quem
  // está mais ao sul aparecer na frente.
  const dr = [];
  if (!escuro) {
    for (let y = y0; y <= Math.min(M.h - 1, y1 + 3); y++) for (let x = x0; x <= x1; x++) {
      if (M.tiles[y][x] === 3) {
        dr.push({ y: y * TILE, f: () => ds(IMG.tree, 0, 0, 96, 144, x * TILE - 32, y * TILE - 112) });
      }
    }
    // Prédios e mobiliário entram na mesma lista ordenada por Y, para quem
    // caminha ao sul de uma fachada aparecer na frente dela.
    for (const b of M.buildings || []) {
      if (b.x > vx1 || b.x + b.w < vx0 || b.y > vy1 || b.y + b.h < vy0) continue;
      dr.push({ y: (b.y + b.h) * TILE, f: () => desenharPredio(b) });
    }
    for (const p of M.props || []) {
      if (p.x > vx1 || p.x < vx0 || p.y > vy1 || p.y < vy0) continue;
      dr.push({ y: (p.y + 1) * TILE, f: () => desenharProp(p) });
    }
    for (const n of NPCS) {
      if (n.map !== mapaAtual) continue;
      dr.push({ y: n.y * TILE, f: () => {
        ds(IMG[n.img], 0, 2 * 64, 64, 64, n.x * TILE - 16, n.y * TILE - 32);
        ctx.fillStyle = SHOPS[n.id] ? '#f0d060' : '#7dd87d';
        ctx.font = `bold ${7 * ZOOM}px Courier New`;
        ctx.textAlign = 'center';
        ctx.fillText(SHOPS[n.id] ? `${n.name.split(' ')[0]} 💰` : n.name.split(' ')[0],
          (n.x * TILE - cam.x + 16) * ZOOM, (n.y * TILE - cam.y - 14) * ZOOM);
      } });
    }
  }

  for (const e of ents.values()) {
    if (e.tipo === 'monstro') {
      dr.push({ y: e.py, f: () => desenharMonstro(e) });
    } else {
      dr.push({ y: e.py, f: () => desenharJogador(e) });
    }
  }

  dr.sort((a, b) => a.y - b.y);
  for (const d of dr) d.f();

  if (dest) {
    const bx = (dest.x * TILE - cam.x) * ZOOM, by = (dest.y * TILE - cam.y) * ZOOM, S = TILE * ZOOM;
    const gl = 0.55 + 0.45 * Math.sin(pulse / 180);
    ctx.strokeStyle = `rgba(240,208,96,${gl})`;
    ctx.lineWidth = 2;
    const c = S * 0.28;
    ctx.beginPath();
    ctx.moveTo(bx, by + c); ctx.lineTo(bx, by); ctx.lineTo(bx + c, by);
    ctx.moveTo(bx + S - c, by); ctx.lineTo(bx + S, by); ctx.lineTo(bx + S, by + c);
    ctx.moveTo(bx + S, by + S - c); ctx.lineTo(bx + S, by + S); ctx.lineTo(bx + S - c, by + S);
    ctx.moveTo(bx + c, by + S); ctx.lineTo(bx, by + S); ctx.lineTo(bx, by + S - c);
    ctx.stroke();
  }

  desenharEfeitos(dt);

  if (escuro) {
    const foco2 = me || { px: 0, py: 0 };
    const cx = (foco2.px + 16 - cam.x) * ZOOM, cy = (foco2.py + 16 - cam.y) * ZOOM;
    const rad = (temTocha() ? 5.2 : 2.6) * TILE * ZOOM;
    const g = ctx.createRadialGradient(cx, cy, rad * 0.35, cx, cy, rad);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.96)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  desenharFlutuantes(dt);
  $('region').textContent = nomeRegiao();
}

// ---------------------------------------------------------
// Cidade: fachadas modulares e mobiliário urbano
// ---------------------------------------------------------

// Desenha uma peça do atlas city.png num tile do mundo.
function peca(variante, nome, dx, dy) {
  if (!CITY) return;
  const v = CITY.variantes[variante] || CITY.variantes.house;
  const p = v && v[nome];
  if (!p) return;
  ds(IMG.city, p[0], p[1], p[2], p[3], dx, dy, p[2], p[3]);
}


// ---------------------------------------------------------
// Terreno com transição
//
// Cada tile de chão pertence a uma família. Onde duas se encontram, quem
// tem PRECEDÊNCIA maior desenha a peça de transição — e essa peça já
// contém as duas texturas (a de cima e a de baixo), então cobre o tile
// inteiro. Sem isso, grama e terra se encostam em linha reta.
// ---------------------------------------------------------
// calcada entra com a maior precedência: ela nunca faz transição com
// terreno natural (é chão de cidade, com borda própria).
const PRECEDENCIA = { agua: 0, areia: 1, terra: 2, grama: 3, calcada: 4 };
const PARES_TERRENO = {
  'grama|terra': 'terreno:grama_terra',
  'grama|areia': 'terreno:grama_areia',
  'areia|agua': 'terreno:areia_agua',
  'terra|areia': 'terreno:terra_areia',
};
const PREENCHIMENTO = {
  grama: ['terreno:grama_terra', 'meio'],
  terra: ['terreno:terra_areia', 'meio'],
  areia: ['terreno:areia_agua', 'meio'],
};

function familiaTerreno(t) {
  if (t === 2) return 'agua';
  if (t === 5) return 'areia';
  if (t === 1 || t === 12) return 'terra';
  if (t === 18) return 'calcada';
  return 'grama';   // grama e tudo que se apoia nela (árvore, rocha, túmulo)
}

function familiaEm(M, x, y) {
  if (x < 0 || y < 0 || x >= M.w || y >= M.h) return null;
  return familiaTerreno(M.tiles[y][x]);
}

// Desenha o chão de um tile. Devolve false se não soube (o chamador
// então usa o desenho antigo por sprite).
function desenharTerreno(M, x, y, fam) {
  if (!SETS) return false;
  const preench = PREENCHIMENTO[fam];
  if (!preench) return false;

  const viz = {
    n: familiaEm(M, x, y - 1), s: familiaEm(M, x, y + 1),
    w: familiaEm(M, x - 1, y), e: familiaEm(M, x + 1, y),
  };
  // Só transiciona contra família de precedência MENOR; a de cima é que
  // desenha a borda, senão as duas desenhariam e uma apagaria a outra.
  const menores = {};
  for (const [dir, f] of Object.entries(viz)) {
    if (f && f !== fam && PRECEDENCIA[f] < PRECEDENCIA[fam]) menores[dir] = f;
  }
  const dirs = Object.keys(menores);
  if (!dirs.length) return pecaSet(preench[0], preench[1], x * TILE, y * TILE);

  const alvo = menores[dirs[0]];
  const chave = PARES_TERRENO[`${fam}|${alvo}`];
  if (!chave || !SETS.conjuntos[chave]) {
    return pecaSet(preench[0], preench[1], x * TILE, y * TILE);
  }
  const v = dirs.includes('n') ? 'n' : (dirs.includes('s') ? 's' : '');
  const h = dirs.includes('w') ? 'w' : (dirs.includes('e') ? 'e' : '');
  return pecaSet(chave, (v + h) || 'meio', x * TILE, y * TILE);
}

// Qual das nove fatias usar para a célula (cx,cy) de um retângulo w x h.
function fatia9(cx, cy, w, h) {
  const v = cy === 0 ? 'n' : (cy === h - 1 ? 's' : '');
  const hh = cx === 0 ? 'w' : (cx === w - 1 ? 'e' : '');
  return (v + hh) || 'meio';
}

// Desenha uma fatia de um conjunto importado ("telhado:vermelho",
// "piso:cinza", "parede:palha"...).
function pecaSet(chave, fatia, dx, dy) {
  if (!SETS) return false;
  const c = SETS.conjuntos[chave];
  const p = c && c.fatias[fatia];
  if (!p) return false;
  ds(IMG['lpc-sets'], p[0], p[1], p[2], p[3], dx, dy, p[2], p[3]);
  return true;
}

// Um prédio é montado de cima para baixo:
//   linhas 0..h-3  TELHADO visto de cima (cumeeira no alto, beiral embaixo)
//   linhas h-2,h-1 parede térrea, com porta e janelas
//
// Essa é a estrutura de um prédio de Tibia: a maior parte do que se vê é
// telhado, e só a faixa da frente mostra parede. Desenhar a fachada
// inteira de frente, como fazíamos, dava a leitura de muro.
//
// A cornija saiu de cena: como faixa de tijolo colorido entre o telhado e
// a pedra, ela virava uma tarja que não combinava com nenhum dos dois. O
// beiral do próprio telhado já faz a transição.
function desenharPredio(b) {
  // Telhado costurável em cima, parede sólida embaixo, porta e janelas por
  // cima dela. Tudo em 9 fatias ou preenchimento, então compõe em qualquer
  // largura e altura — foi o que resolveu depois de duas tentativas com
  // peças prontas do LPC, que não são costuráveis e vinham com lixo das
  // peças vizinhas da folha.
  const linhas = b.h - 2;
  const cumeeira = Math.max(0, Math.floor((linhas - 1) / 2));

  // Sombra projetada no chão, deslocada para baixo e para a direita. Sem
  // ela o prédio não tem volume: fica um retângulo de textura colado no
  // calçamento, que era exatamente a queixa.
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.fillRect(
    (b.x * TILE + 6 - cam.x) * ZOOM,
    ((b.y + b.h) * TILE - 10 - cam.y) * ZOOM,
    (b.w * TILE + 6) * ZOOM, 12 * ZOOM);

  if (TELHADOS) {
    const cor = TELHADOS.cores[b.telhado] || TELHADOS.cores.telha;
    // O telhado AVANÇA um tile para cada lado da parede. É esse beiral que
    // dá silhueta; alinhado com a parede, o prédio vira um bloco chapado.
    const larg = b.w + 2;
    for (let cy = 0; cy < linhas; cy++) {
      for (let cxi = 0; cxi < larg; cxi++) {
        const cx = cxi - 1;
        const esq = cxi === 0, dir = cxi === larg - 1, baixo = cy === linhas - 1;
        let nome;
        if (baixo && esq) nome = 'canto_esq';
        else if (baixo && dir) nome = 'canto_dir';
        else if (baixo) nome = 'beira_baixo';
        else if (cy === cumeeira) nome = 'cume';
        else if (esq) nome = 'beira_esq';
        else if (dir) nome = 'beira_dir';
        else nome = cy < cumeeira ? 'campo_topo' : 'campo';
        const p = cor[nome];
        if (p) ds(IMG.roof, p[0], p[1], p[2], p[3], (b.x + cx) * TILE, (b.y + cy) * TILE, p[2], p[3]);
      }
    }
  }

  // Parede: só o PREENCHIMENTO do conjunto. As nove fatias do tijolo LPC
  // são feitas para transicionar com outro terreno, e soltas deixam a
  // parede com a borda esfarrapada.
  const paredeY = b.y + b.h - 2;
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < b.w; cx++) {
      pecaSet(`parede:${b.parede || 'palha'}`, 'meio',
        (b.x + cx) * TILE, (paredeY + cy) * TILE);
    }
  }

  if (PROPS) {
    const porta = PROPS.props.porta;
    if (porta) {
      ds(IMG['lpc-props'], porta.x, porta.y, porta.w, porta.h,
        (b.x + b.porta) * TILE, paredeY * TILE, porta.w, porta.h);
    }
    const jan = PROPS.props.janela;
    if (jan) {
      for (const cx of b.janelas) {
        if (cx === b.porta) continue;
        ds(IMG['lpc-props'], jan.x, jan.y, jan.w, jan.h,
          (b.x + cx) * TILE, (paredeY + 1) * TILE, jan.w, jan.h);
      }
    }
  }

  if (b.tipo) desenharLetreiro(b);
}

// Cor do toldo e emblema por tipo de estabelecimento. É isto — e não uma
// fachada diferente — que faz reconhecer a armaria de longe.
const ESTABELECIMENTOS = {
  armaria:    { toldo: '#8c3b2e', nome: '#f0d060' },
  botica:     { toldo: '#3d7a52', nome: '#8fe0a0' },
  banco:      { toldo: '#2f4a7a', nome: '#9ac0f0' },
  prefeitura: { toldo: '#5a4a7a', nome: '#c8b0f0' },
  templo:     { toldo: '#6a5a8c', nome: '#cbb8ff' },
  estacao:    { toldo: '#7a5a2e', nome: '#e0c080' },
  taverna:    { toldo: '#7a4a24', nome: '#e8b070' },
  biblioteca: { toldo: '#4a5a7a', nome: '#a8c0e0' },
};

function desenharLetreiro(b) {
  const est = ESTABELECIMENTOS[b.tipo] || ESTABELECIMENTOS.armaria;
  const S = TILE * ZOOM;
  const portaX = (b.x + b.porta) * TILE;
  const cornijaY = (b.y + b.h - 3) * TILE;
  const bx = (portaX - cam.x) * ZOOM;
  const by = (cornijaY - cam.y) * ZOOM;

  // --- toldo listrado sobre a porta ---
  ctx.fillStyle = est.toldo;
  ctx.fillRect(bx - S * 0.14, by + S * 0.72, S * 1.28, S * 0.3);
  ctx.fillStyle = 'rgba(240,236,224,.85)';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(bx - S * 0.14 + S * (0.16 + i * 0.32), by + S * 0.72, S * 0.16, S * 0.3);
  }
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(bx - S * 0.14, by + S * 1.0, S * 1.28, S * 0.06);

  // --- tabuleta pendurada ao lado da porta ---
  const sx = bx + S * 1.05, sy = by + S * 0.28;
  ctx.fillStyle = '#3a3128';
  ctx.fillRect(bx + S * 0.9, by + S * 0.2, S * 0.4, S * 0.07);
  ctx.fillRect(sx + S * 0.26, by + S * 0.24, S * 0.05, S * 0.12);
  ctx.fillStyle = '#5a4020';
  ctx.fillRect(sx, sy + S * 0.08, S * 0.56, S * 0.44);
  ctx.fillStyle = '#7a5a30';
  ctx.fillRect(sx + S * 0.04, sy + S * 0.12, S * 0.48, S * 0.36);
  desenharEmblema(b.tipo, sx + S * 0.28, sy + S * 0.3, S * 0.34);

  // --- nome acima do telhado ---
  if (b.nome) {
    const nx = (b.x + b.w / 2) * TILE - cam.x;
    const ny = b.y * TILE - cam.y - 6;
    ctx.font = `bold ${7 * ZOOM}px Courier New`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,.75)';
    const larg = ctx.measureText(b.nome).width;
    ctx.fillRect(nx * ZOOM - larg / 2 - 4, ny * ZOOM - 9 * ZOOM, larg + 8, 10 * ZOOM);
    ctx.fillStyle = est.nome;
    ctx.fillText(b.nome, nx * ZOOM, ny * ZOOM - ZOOM);
  }
}

// Emblemas desenhados com primitivas: um símbolo legível a 2x vale mais
// que um ícone detalhado que vira mancha.
function desenharEmblema(tipo, cx, cy, t) {
  const q = (x, y, w, h, cor) => { ctx.fillStyle = cor; ctx.fillRect(cx + x * t, cy + y * t, w * t, h * t); };
  switch (tipo) {
    case 'armaria': // espada cruzando escudo
      q(-0.10, -0.55, 0.20, 0.75, '#d8d4c8');
      q(-0.22, 0.12, 0.44, 0.12, '#8a6a34');
      q(-0.05, 0.20, 0.10, 0.30, '#5a4020');
      q(0.14, -0.30, 0.34, 0.50, '#6a7a9a');
      q(0.18, -0.24, 0.26, 0.36, '#8fa0c0');
      break;
    case 'botica': // frasco de poção
      q(-0.10, -0.55, 0.20, 0.18, '#cfd8dc');
      q(-0.22, -0.38, 0.44, 0.70, '#b6c4c9');
      q(-0.16, -0.10, 0.32, 0.38, '#5ac07a');
      q(-0.16, -0.18, 0.32, 0.08, '#8fe0a0');
      break;
    case 'banco': // pilha de moedas
      for (let i = 0; i < 3; i++) {
        q(-0.26 + i * 0.02, 0.24 - i * 0.22, 0.52 - i * 0.04, 0.18, '#e0b840');
        q(-0.22 + i * 0.02, 0.26 - i * 0.22, 0.44 - i * 0.04, 0.06, '#f5e08a');
      }
      break;
    case 'prefeitura': // estandarte
      q(-0.06, -0.60, 0.10, 1.10, '#6a5a44');
      q(0.02, -0.56, 0.44, 0.42, '#8c6ad0');
      q(0.02, -0.30, 0.44, 0.10, '#c8b0f0');
      break;
    case 'templo': // sol/eclipse
      ctx.fillStyle = '#f0e0a0';
      ctx.beginPath(); ctx.arc(cx, cy, t * 0.34, 0, 7); ctx.fill();
      ctx.fillStyle = '#3a2a5a';
      ctx.beginPath(); ctx.arc(cx + t * 0.12, cy - t * 0.06, t * 0.26, 0, 7); ctx.fill();
      break;
    case 'estacao': // roda de carruagem
      ctx.strokeStyle = '#c8a060'; ctx.lineWidth = Math.max(1, t * 0.12);
      ctx.beginPath(); ctx.arc(cx, cy, t * 0.42, 0, 7); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * t * 0.4, cy - Math.sin(a) * t * 0.4);
        ctx.lineTo(cx + Math.cos(a) * t * 0.4, cy + Math.sin(a) * t * 0.4);
        ctx.stroke();
      }
      break;
    case 'taverna': // caneca
      q(-0.30, -0.34, 0.48, 0.68, '#c8b48a');
      q(-0.26, -0.28, 0.40, 0.20, '#f2ece0');
      q(0.18, -0.18, 0.18, 0.10, '#c8b48a');
      q(0.28, -0.18, 0.08, 0.34, '#c8b48a');
      q(0.18, 0.16, 0.18, 0.10, '#c8b48a');
      break;
    case 'biblioteca': // livro aberto
      q(-0.44, -0.26, 0.42, 0.56, '#d8d0bc');
      q(0.02, -0.26, 0.42, 0.56, '#e8e0cc');
      q(-0.03, -0.30, 0.06, 0.64, '#7a5a30');
      break;
    default:
      break;
  }
}

// Mobiliário desenhado com primitivas — mesma técnica que o jogo já usava
// para placas e estantes. Evita depender de arte que não existe no pacote.
function desenharProp(p) {
  // Arte de verdade primeiro. O desenho com retângulos abaixo era o
  // remendo de quando não havia mobiliário no pacote, e fica como reserva.
  if (PROPS && PROPS.props[p.t]) {
    const a = PROPS.props[p.t];
    const [tw, th] = a.tiles;
    // Ancorado pela base: um poste de 2 tiles cresce para cima a partir
    // do tile que ele ocupa, como uma árvore.
    ds(IMG['lpc-props'], a.x, a.y, a.w, a.h,
      p.x * TILE, (p.y - (th - 1)) * TILE, a.w, a.h);
    return;
  }

  const bx = (p.x * TILE - cam.x) * ZOOM, by = (p.y * TILE - cam.y) * ZOOM;
  const S = TILE * ZOOM;
  const r = (x, y, w, h, cor) => { ctx.fillStyle = cor; ctx.fillRect(bx + S * x, by + S * y, S * w, S * h); };

  switch (p.t) {
    case '_vazio': // tile só de colisão de um objeto grande
      break;
    case 'fonte': {
      // Ocupa 2x2 tiles: tanque octogonal, pilar central e água pulsando.
      const L = S * (p.w || 2), A = S * (p.h || 2);
      const cx = bx + L / 2, cy = by + A / 2;
      ctx.fillStyle = '#5d574f';
      ctx.beginPath(); ctx.ellipse(cx, cy + A * 0.06, L * 0.46, A * 0.40, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#8a857c';
      ctx.beginPath(); ctx.ellipse(cx, cy, L * 0.44, A * 0.38, 0, 0, 7); ctx.fill();
      const brilho = 0.5 + 0.5 * Math.sin(pulse / 420);
      ctx.fillStyle = `rgb(52,${106 + Math.round(16 * brilho)},${168 + Math.round(24 * brilho)})`;
      ctx.beginPath(); ctx.ellipse(cx, cy, L * 0.34, A * 0.28, 0, 0, 7); ctx.fill();
      // pilar e jato
      ctx.fillStyle = '#9a948a';
      ctx.fillRect(cx - L * 0.06, cy - A * 0.30, L * 0.12, A * 0.34);
      ctx.fillStyle = `rgba(200,232,250,${0.55 + 0.35 * brilho})`;
      ctx.fillRect(cx - L * 0.03, cy - A * 0.44, L * 0.06, A * 0.18);
      ctx.beginPath(); ctx.ellipse(cx, cy - A * 0.30, L * 0.15, A * 0.05, 0, 0, 7); ctx.fill();
      break;
    }
    case 'poco':
      r(0.1, 0.35, 0.8, 0.55, '#7a7168');
      r(0.2, 0.45, 0.6, 0.4, '#1b2430');
      r(0.14, 0.05, 0.72, 0.16, '#5a3a1a');
      r(0.44, 0.18, 0.12, 0.24, '#4a3018');
      break;
    case 'lampiao': {
      // Sobe acima do próprio tile para ter cara de poste, não de caixinha.
      const alt = S * 1.1;
      r(0.4, 0.35, 0.2, 0.62, '#2e281f');
      ctx.fillStyle = '#3a3128';
      ctx.fillRect(bx + S * 0.44, by + S * 0.9 - alt, S * 0.12, alt - S * 0.55);
      ctx.fillRect(bx + S * 0.3, by + S * 0.92, S * 0.4, S * 0.08);
      const glow = 0.6 + 0.4 * Math.sin(pulse / 300);
      const ly = by + S * 0.9 - alt;
      ctx.fillStyle = `rgba(255,206,110,${0.16 * glow})`;
      ctx.beginPath(); ctx.arc(bx + S * 0.5, ly + S * 0.16, S * 0.85, 0, 7); ctx.fill();
      ctx.fillStyle = '#2a241a';
      ctx.fillRect(bx + S * 0.32, ly, S * 0.36, S * 0.34);
      ctx.fillStyle = `rgba(255,222,140,${0.75 + 0.25 * glow})`;
      ctx.fillRect(bx + S * 0.37, ly + S * 0.05, S * 0.26, S * 0.24);
      ctx.fillStyle = '#3a3128';
      ctx.fillRect(bx + S * 0.28, ly - S * 0.08, S * 0.44, S * 0.08);
      break;
    }
    case 'banca': // barraca de mercado
      r(0.05, 0.5, 0.9, 0.42, '#6b4a24');
      r(0.05, 0.44, 0.9, 0.1, '#8a6034');
      for (let i = 0; i < 5; i++) {
        r(0.05 + i * 0.18, 0.06, 0.18, 0.34, i % 2 ? '#c04a3a' : '#e8dcc0');
      }
      r(0.05, 0.38, 0.9, 0.08, '#4a3018');
      break;
    case 'engradado':
      r(0.08, 0.18, 0.84, 0.74, '#8a6034');
      r(0.14, 0.24, 0.72, 0.62, '#6b4a24');
      r(0.08, 0.5, 0.84, 0.08, '#4a3018');
      r(0.46, 0.18, 0.08, 0.74, '#4a3018');
      break;
    case 'barril':
      r(0.16, 0.16, 0.68, 0.76, '#7a5228');
      r(0.16, 0.3, 0.68, 0.08, '#3a2810');
      r(0.16, 0.66, 0.68, 0.08, '#3a2810');
      r(0.24, 0.16, 0.52, 0.1, '#9a6a38');
      break;
    case 'banco': // banco de praça
      r(0.06, 0.42, 0.88, 0.16, '#7a5a34');
      r(0.06, 0.3, 0.88, 0.1, '#8a6a3c');
      r(0.12, 0.58, 0.1, 0.28, '#4a3a24');
      r(0.78, 0.58, 0.1, 0.28, '#4a3a24');
      r(0.06, 0.24, 0.06, 0.2, '#4a3a24');
      r(0.88, 0.24, 0.06, 0.2, '#4a3a24');
      break;
    case 'arvorinha': {
      // Reaproveita os tufos de grama do atlas — linhas que o jogo
      // original nunca desenhava.
      ds(IMG.grass, 0, 0, 32, 32, p.x * TILE, p.y * TILE - 8);
      ds(IMG.grass, 0, 0, 32, 32, p.x * TILE, p.y * TILE);
      break;
    }
    case 'torre':
      // Nasce sobre a muralha: sobe bem acima do tile para virar silhueta.
      ctx.fillStyle = '#4a4740';
      ctx.fillRect(bx - S * 0.12, by - S * 1.5, S * 1.24, S * 2.5);
      ctx.fillStyle = '#6a665c';
      ctx.fillRect(bx - S * 0.04, by - S * 1.4, S * 1.08, S * 2.3);
      ctx.fillStyle = '#3a3730';
      for (let i = 0; i < 4; i++) ctx.fillRect(bx + S * (0.02 + i * 0.28), by - S * 1.62, S * 0.16, S * 0.26);
      ctx.fillStyle = '#1b2430';
      ctx.fillRect(bx + S * 0.38, by - S * 0.9, S * 0.24, S * 0.4);
      break;
    default:
      break;
  }
}

// Calçamento: paralelepípedos desenhados com deslocamento determinístico,
// para a cidade não ter o mesmo chão de terra do campo.
function desenharCalcamento(x, y, v) {
  // Calçamento de verdade, importado do pacote LPC. O desenho procedural
  // abaixo era o remendo de quando não havia arte; fica como reserva para
  // o caso de o atlas não carregar.
  if (pecaSet('piso:cinza', 'meio', x * TILE, y * TILE)) return;

  const bx = (x * TILE - cam.x) * ZOOM, by = (y * TILE - cam.y) * ZOOM;
  const S = TILE * ZOOM;
  ctx.fillStyle = '#565049';
  ctx.fillRect(bx, by, S, S);
  const tons = ['#6e675e', '#777066', '#655e56', '#7d766b'];
  for (let i = 0; i < 4; i++) {
    const lin = Math.floor(i / 2), col = i % 2;
    // O deslocamento alternado por linha imita fiada de pedra.
    const desl = (lin + v) % 2 ? 0.12 : 0;
    ctx.fillStyle = tons[(x * 3 + y * 5 + i + v) % tons.length];
    ctx.fillRect(bx + S * (col * 0.5 + desl) + 1, by + S * (lin * 0.5) + 1,
      S * 0.5 - 2, S * 0.5 - 2);
  }
}

function desenharJogador(e) {
  const andando = e.px !== e.x * TILE || e.py !== e.y * TILE;
  const col = andando ? 1 + e.frame : 0;
  const sprite = IMG[e.sprite] || IMG.soldier;
  ctx.globalAlpha = e.dead ? 0.35 : 1;
  ds(sprite, col * 64, (e.d || 0) * 64, 64, 64, e.px - 16, e.py - 32);
  ctx.globalAlpha = 1;
  barraVida(e.px, e.py, e.hp, e.hpMax, 26, 36);

  // Nome: o meu em dourado, os outros em verde — dá para se achar na tela
  // mesmo com várias pessoas em cima do mesmo tile.
  ctx.font = `bold ${7 * ZOOM}px Courier New`;
  ctx.textAlign = 'center';
  const nx = (e.px - cam.x + 16) * ZOOM, ny = (e.py - cam.y - 22) * ZOOM;
  ctx.fillStyle = '#000';
  ctx.fillText(`${e.nick} (${e.lvl})`, nx + 1, ny + 1);
  ctx.fillStyle = e.id === meuId ? '#f0d060' : '#8fe08f';
  ctx.fillText(`${e.nick} (${e.lvl})`, nx, ny);

  const bolha = bolhas.get(e.id);
  if (bolha && performance.now() < bolha.ate) {
    ctx.font = `${7 * ZOOM}px Courier New`;
    ctx.fillStyle = '#000';
    ctx.fillText(bolha.texto, nx + 1, ny - 9 * ZOOM + 1);
    ctx.fillStyle = '#e8dcc0';
    ctx.fillText(bolha.texto, nx, ny - 9 * ZOOM);
  }
}

function desenharMonstro(e) {
  const sp = MSPR[e.sprite] || { fw: 32, fh: 32 };
  const s = e.scale || 1;
  const dw = sp.fw * s, dh = sp.fh * s;
  ds(IMG[e.sprite], e.frame * sp.fw, (e.d || 0) * sp.fh, sp.fw, sp.fh,
    e.px + 16 - dw / 2, e.py + 32 - dh, dw, dh);
  barraVida(e.px, e.py, e.hp, e.hpMax, e.boss ? 30 : 24, dh - 26);
  if (e.boss) {
    ctx.fillStyle = '#ff5555';
    ctx.font = `bold ${7 * ZOOM}px Courier New`;
    ctx.textAlign = 'center';
    ctx.fillText(e.name, (e.px - cam.x + 16) * ZOOM, (e.py - cam.y - dh + 8) * ZOOM);
  }
  if (alvo === e.id) {
    ctx.strokeStyle = '#ff2222';
    ctx.lineWidth = 2;
    ctx.strokeRect((e.px + 16 - dw / 2 - cam.x) * ZOOM, (e.py + 32 - dh - cam.y) * ZOOM,
      dw * ZOOM, dh * ZOOM);
  }
}

function desenharEfeitos(dt) {
  for (const f of effects) {
    f.life -= dt;
    const p = 1 - f.life / f.max;
    const cx = (f.x - cam.x) * ZOOM, cy = (f.y - cam.y) * ZOOM;
    if (f.tipo === 'slash') {
      ctx.strokeStyle = `rgba(255,255,255,${1 - p})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 10 * ZOOM * p + 4, -0.9 + p * 2, 0.9 + p * 2);
      ctx.stroke();
    } else if (f.tipo === 'aoe') {
      const r = TILE * 1.5 * ZOOM * p;
      ctx.strokeStyle = `rgba(255,140,40,${1 - p})`;
      ctx.lineWidth = 5 * (1 - p) + 1;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
      ctx.strokeStyle = `rgba(255,220,120,${(1 - p) * 0.8})`;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.7, 0, 7); ctx.stroke();
    } else if (f.tipo === 'bolt' || f.tipo === 'shot') {
      const x2 = (f.x2 - cam.x) * ZOOM, y2 = (f.y2 - cam.y) * ZOOM;
      const px = cx + (x2 - cx) * p, py = cy + (y2 - cy) * p;
      const cor = f.tipo === 'bolt' ? '255,150,40' : '220,220,180';
      ctx.strokeStyle = `rgba(${cor},${0.7 * (1 - p)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
      ctx.fillStyle = `rgb(${cor})`;
      ctx.beginPath(); ctx.arc(px, py, 3 * ZOOM, 0, 7); ctx.fill();
    }
  }
  effects = effects.filter((f) => f.life > 0);
}

function desenharFlutuantes(dt) {
  ctx.font = `bold ${9 * ZOOM}px Courier New`;
  ctx.textAlign = 'center';
  for (const f of floats) {
    f.life -= dt;
    f.y -= dt * 0.02;
    ctx.globalAlpha = Math.min(1, f.life / 400);
    ctx.fillStyle = '#000';
    ctx.fillText(f.txt, (f.x - cam.x) * ZOOM + 1, (f.y - cam.y) * ZOOM + 1);
    ctx.fillStyle = f.cor;
    ctx.fillText(f.txt, (f.x - cam.x) * ZOOM, (f.y - cam.y) * ZOOM);
    ctx.globalAlpha = 1;
  }
  floats = floats.filter((f) => f.life > 0);
}

// ---------------------------------------------------------
// Laço principal
// ---------------------------------------------------------
let ultimo = 0;
function laco(t) {
  const dt = Math.min(50, t - ultimo);
  ultimo = t;
  passosSegurados(t);
  interpolar(dt);
  render(dt);
  atualizarRecarga(dt);
  requestAnimationFrame(laco);
}

// O servidor manda o cooldown restante junto do estado privado; aqui só
// descontamos o tempo entre uma atualização e outra para a bolinha ficar fluida.
function atualizarRecarga(dt) {
  const cd = $('spellcd');
  if (!eu) return;
  recargaMagia = Math.max(0, recargaMagia - dt);
  const total = CLASSES[eu.cls].spell.cd;
  if (recargaMagia > 0) {
    cd.style.display = 'block';
    cd.style.height = `${100 * recargaMagia / total}%`;
  } else {
    cd.style.display = 'none';
  }
}

carregarSprites().then(() => {
  conectar();
  requestAnimationFrame(laco);
});
