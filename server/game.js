// =========================================================
// Simulação autoritativa.
//
// Regra que orienta o arquivo inteiro: o cliente manda INTENÇÃO
// ("quero ir até o tile 12,7", "quero atacar a entidade m14") e nunca
// resultado. Posição, dano, XP, ouro e loot são decididos aqui. Um cliente
// adulterado consegue, no máximo, pedir coisas inválidas — que são negadas.
// =========================================================

import { buildWorld, BLOCK, DIR } from '../public/shared/world.js';
import {
  CLASSES, MTYPES, NPCS, SPAWNS, ITEMS, EQ_SLOTS, SHOPS,
  RESPAWN_POINTS, PORTALS, PORTAIS, TEMPLOS, DESTINOS, ESTACOES, BANCARIOS,
  baseStats, spellPower, xpNeeded,
} from '../public/shared/content.js';
import { query } from './db.js';

const TICK_MS = 100;
const MOVE_MS = 250;          // um tile do jogador
const RESPAWN_MS = 20_000;    // monstro comum
const BOSS_RESPAWN_MS = 600_000; // chefe: 10 min, senão só o primeiro grupo o vê
const DEATH_MS = 3_000;
const SAVE_MS = 30_000;
const CHAT_MAX = 200;
const AGGRO = 6, AGGRO_BOSS = 8;

const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export class Game {
  constructor() {
    this.maps = buildWorld();
    this.players = new Map();   // charId(string) -> jogador
    this.monsters = [];
    this.chestsTaken = new Set(); // "mapa:x,y" já saqueados (reabrem no boot)
    this.spawnMonsters();
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.saveTimer = setInterval(() => this.saveAll(), SAVE_MS);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.saveTimer);
  }

  // -------------------------------------------------------
  // Monstros
  // -------------------------------------------------------
  spawnMonsters() {
    this.monsters = SPAWNS.map(([type, map, x, y], i) => {
      const t = MTYPES[type];
      return {
        id: `m${i}`, type, map, name: t.name,
        sprite: t.sprite || type, scale: t.scale || 1,
        tx: x, ty: y, sx: x, sy: y, dir: DIR.down,
        hp: t.hp, hpMax: t.hp, alive: true,
        aiCd: Math.random() * 900, respawn: 0,
        boss: !!t.boss, static: !!t.static,
        damage: new Map(), // charId -> dano acumulado, para dividir o XP
      };
    });
  }

  // -------------------------------------------------------
  // Colisão e caminho
  // -------------------------------------------------------
  inBounds(map, x, y) {
    const M = this.maps[map];
    return M && x >= 0 && y >= 0 && x < M.w && y < M.h;
  }

  terrainOk(map, x, y) {
    if (!this.inBounds(map, x, y)) return false;
    return !BLOCK.has(this.maps[map].tiles[y][x]);
  }

  // `ignore` deixa a própria entidade fora do teste ao planejar o caminho.
  walkable(map, x, y, ignore) {
    if (!this.terrainOk(map, x, y)) return false;
    if (NPCS.some((n) => n.map === map && n.x === x && n.y === y)) return false;
    for (const m of this.monsters) {
      if (m.alive && m.map === map && m.tx === x && m.ty === y && m !== ignore) return false;
    }
    for (const p of this.players.values()) {
      if (!p.dead && p.map === map && p.tx === x && p.ty === y && p !== ignore) return false;
    }
    return true;
  }

  // BFS: mapas pequenos (no máximo 44x34), então busca exaustiva é barata
  // e sempre devolve o caminho mais curto.
  findPath(map, sx, sy, gx, gy, near) {
    const M = this.maps[map];
    if (!M) return [];
    const key = (x, y) => y * M.w + x;
    const start = key(sx, sy), goal = key(gx, gy);
    // Para planejar, monstros não bloqueiam: eles se movem. NPCs e terreno sim.
    const passable = (x, y) => this.terrainOk(map, x, y)
      && !NPCS.some((n) => n.map === map && n.x === x && n.y === y);

    const prev = new Map([[start, -1]]);
    const q = [[sx, sy]];
    let found = -1;
    for (let head = 0; head < q.length; head++) {
      const [cx, cy] = q[head];
      const ck = key(cx, cy);
      if (ck === goal) { found = ck; break; }
      if (near && Math.abs(cx - gx) <= 1 && Math.abs(cy - gy) <= 1) { found = ck; break; }
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.inBounds(map, nx, ny)) continue;
        const nk = key(nx, ny);
        if (prev.has(nk)) continue;
        const isGoal = nk === goal;
        if (!isGoal && !passable(nx, ny)) continue;
        prev.set(nk, ck);
        q.push([nx, ny]);
      }
    }
    if (found < 0) return [];
    const path = [];
    let cur = found;
    while (cur !== start) {
      path.push({ x: cur % M.w, y: Math.floor(cur / M.w) });
      cur = prev.get(cur);
    }
    path.reverse();
    // O tile do alvo em si não é pisável quando pedimos "chegue perto".
    if (near && path.length && path[path.length - 1].x === gx && path[path.length - 1].y === gy) path.pop();
    return path;
  }

  // -------------------------------------------------------
  // Entrada e saída de jogadores
  // -------------------------------------------------------
  addPlayer(char, ws) {
    const stats = baseStats(char.class_id, char.level);
    const p = {
      id: `p${char.id}`, charId: String(char.id), accountId: String(char.account_id),
      nick: char.nickname, classId: char.class_id, sprite: CLASSES[char.class_id].sprite,
      level: char.level, xp: char.xp, gold: char.gold,
      hp: Math.min(char.hp, stats.hpMax), mp: Math.min(char.mp, stats.mpMax),
      map: char.map, tx: char.tx, ty: char.ty, dir: DIR.down,
      inv: Array.isArray(char.inventory) ? char.inventory : [],
      eq: char.equipment || { weapon: null, shield: null, armor: null, ring: null },
      quest: char.quest || {},
      home: char.home || null,   // templo registrado; null = usa o da região
      path: [], target: null, moveCd: 0, atkCd: 0, spellCd: 0,
      dead: false, deadUntil: 0, ws, dirty: true, events: [],
    };
    // Se o ponto salvo ficou ocupado (outro jogador parado ali), empurra
    // para o vizinho livre mais próximo em vez de sobrepor os dois.
    if (!this.walkable(p.map, p.tx, p.ty, p)) {
      const free = this.nearestFree(p.map, p.tx, p.ty, p);
      p.tx = free.x; p.ty = free.y;
    }
    this.players.set(p.charId, p);
    return p;
  }

  nearestFree(map, x, y, ignore) {
    for (let r = 0; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (this.walkable(map, x + dx, y + dy, ignore)) return { x: x + dx, y: y + dy };
      }
    }
    return { x, y };
  }

  async removePlayer(charId) {
    const p = this.players.get(charId);
    if (!p) return;
    await this.save(p);
    this.players.delete(charId);
    // Quem some da tela precisa sumir para os outros também.
    this.broadcastMap(p.map, { t: 'left', id: p.id }, p.charId);
  }

  // -------------------------------------------------------
  // Atributos derivados
  // -------------------------------------------------------
  eqSum(p, field) {
    return EQ_SLOTS.reduce((a, s) => {
      const id = p.eq[s];
      return a + (id && ITEMS[id] && ITEMS[id][field] ? ITEMS[id][field] : 0);
    }, 0);
  }

  stats(p) {
    const b = baseStats(p.classId, p.level);
    return {
      hpMax: b.hpMax, mpMax: b.mpMax,
      atk: b.atk + this.eqSum(p, 'atk'),
      def: b.def + this.eqSum(p, 'def'),
    };
  }

  // -------------------------------------------------------
  // Comandos vindos do cliente
  // -------------------------------------------------------
  command(p, msg) {
    if (!p || p.dead) {
      if (msg && msg.t === 'chat') this.chat(p, msg.text);
      return;
    }
    switch (msg.t) {
      case 'go': return this.cmdGo(p, msg);
      case 'step': return this.cmdStep(p, msg);
      case 'attack': return this.cmdAttack(p, msg);
      case 'stop': p.path = []; p.target = null; return;
      case 'spell': return this.cmdSpell(p);
      case 'use': return this.cmdUse(p, msg);
      case 'equip': return this.cmdEquip(p, msg);
      case 'unequip': return this.cmdUnequip(p, msg);
      case 'interact': return this.cmdInteract(p, msg);
      case 'buy': return this.cmdBuy(p, msg);
      case 'sell': return this.cmdSell(p, msg);
      // cmdBanco toca o banco de dados: a rejeição precisa ser capturada
      // aqui, senão vira unhandledRejection e não chega ao jogador.
      case 'banco':
        return this.cmdBanco(p, msg).catch((err) => {
          console.error('[banco] falhou:', err.message);
          this.toast(p, 'O caixa não conseguiu concluir a operação.');
        });
      case 'viajar': return this.cmdViajar(p, msg);
      case 'chat': return this.chat(p, msg.text);
      default: return;
    }
  }

  cmdGo(p, { x, y }) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    if (!this.inBounds(p.map, x, y)) return;
    p.target = null;
    p.path = this.findPath(p.map, p.tx, p.ty, x, y, false);
    if (!p.path.length) p.path = this.findPath(p.map, p.tx, p.ty, x, y, true);
  }

  cmdStep(p, { dx, dy }) {
    if (![-1, 0, 1].includes(dx) || ![-1, 0, 1].includes(dy)) return;
    if (dx && dy) return; // só ortogonal
    p.path = []; p.target = null;
    if (p.moveCd > 0) return;
    this.face(p, dx, dy);
    if (this.walkable(p.map, p.tx + dx, p.ty + dy, p)) {
      p.tx += dx; p.ty += dy; p.moveCd = MOVE_MS;
      this.onArrive(p);
    }
  }

  cmdAttack(p, { id }) {
    const m = this.monsters.find((x) => x.id === id && x.alive && x.map === p.map);
    if (!m) return;
    p.target = m.id;
    const cls = CLASSES[p.classId];
    const d = Math.max(Math.abs(m.tx - p.tx), Math.abs(m.ty - p.ty));
    if (d > cls.range) p.path = this.findPath(p.map, p.tx, p.ty, m.tx, m.ty, true);
    else p.path = [];
  }

  cmdSpell(p) {
    const cls = CLASSES[p.classId];
    const s = cls.spell;
    if (p.spellCd > 0) return this.toast(p, `${s.name} em recarga...`);
    if (p.mp < s.cost) return this.toast(p, `Mana insuficiente (${s.cost} MP)`);
    p.mp -= s.cost; p.spellCd = s.cd; p.dirty = true;
    const power = spellPower(p.classId, p.level);

    if (s.kind === 'aoe') {
      let hits = 0;
      for (const m of this.monsters) {
        if (!m.alive || m.map !== p.map) continue;
        if (Math.abs(m.tx - p.tx) <= s.radius && Math.abs(m.ty - p.ty) <= s.radius) {
          this.damageMonster(m, power, p); hits++;
        }
      }
      this.fx(p.map, { t: 'fx', kind: 'aoe', x: p.tx, y: p.ty, by: p.id });
      this.toast(p, hits ? `${s.name}! Atingiu ${hits} criatura(s).` : `${s.name}! Nenhum alvo por perto.`);
    } else if (s.kind === 'bolt') {
      const m = this.pickBolt(p, s.range);
      if (!m) { p.mp += s.cost; p.spellCd = 0; return this.toast(p, 'Nenhum alvo à vista.'); }
      this.fx(p.map, { t: 'fx', kind: 'bolt', x: p.tx, y: p.ty, tx: m.tx, ty: m.ty, by: p.id });
      this.damageMonster(m, power, p);
    } else if (s.kind === 'heal') {
      let n = 0;
      for (const o of this.players.values()) {
        if (o.map !== p.map || o.dead) continue;
        if (Math.abs(o.tx - p.tx) > s.radius || Math.abs(o.ty - p.ty) > s.radius) continue;
        const max = this.stats(o).hpMax;
        if (o.hp >= max) continue;
        const before = o.hp;
        o.hp = Math.min(max, o.hp + power); o.dirty = true; n++;
        this.fx(p.map, { t: 'fx', kind: 'heal', x: o.tx, y: o.ty, amount: o.hp - before });
      }
      this.toast(p, n ? `${s.name}! Curou ${n} alvo(s).` : `${s.name}! Ninguém precisava de cura.`);
    }
  }

  // Alvo do projétil: o monstro vivo mais próximo dentro do alcance.
  pickBolt(p, range) {
    let best = null, bestD = Infinity;
    for (const m of this.monsters) {
      if (!m.alive || m.map !== p.map) continue;
      const d = Math.max(Math.abs(m.tx - p.tx), Math.abs(m.ty - p.ty));
      if (d <= range && d < bestD) { best = m; bestD = d; }
    }
    return best;
  }

  cmdUse(p, { idx }) {
    const slot = p.inv[idx];
    if (!slot) return;
    const it = ITEMS[slot.id];
    if (!it) return;
    const st = this.stats(p);
    if (it.use === 'heal') {
      if (p.hp >= st.hpMax) return this.toast(p, 'Sua vida já está cheia.');
      p.hp = Math.min(st.hpMax, p.hp + it.heal);
      this.fx(p.map, { t: 'fx', kind: 'heal', x: p.tx, y: p.ty, amount: it.heal });
    } else if (it.use === 'mana') {
      if (p.mp >= st.mpMax) return this.toast(p, 'Sua mana já está cheia.');
      p.mp = Math.min(st.mpMax, p.mp + it.mana);
    } else if (it.slot) {
      return this.cmdEquip(p, { idx });
    } else {
      return this.toast(p, it.passive || 'Nada acontece.');
    }
    this.consume(p, idx);
    p.dirty = true;
  }

  cmdEquip(p, { idx }) {
    const slot = p.inv[idx];
    if (!slot) return;
    const it = ITEMS[slot.id];
    if (!it || !it.slot) return;
    const anterior = p.eq[it.slot];
    p.eq[it.slot] = slot.id;
    this.consume(p, idx);
    if (anterior) this.addItem(p, anterior);
    p.hp = Math.min(p.hp, this.stats(p).hpMax);
    p.dirty = true;
    this.toast(p, `${it.name} equipado.`);
  }

  cmdUnequip(p, { slot }) {
    if (!EQ_SLOTS.includes(slot) || !p.eq[slot]) return;
    const id = p.eq[slot];
    p.eq[slot] = null;
    this.addItem(p, id);
    p.hp = Math.min(p.hp, this.stats(p).hpMax);
    p.dirty = true;
  }

  cmdInteract(p, { x, y }) {
    if (!this.inBounds(p.map, x, y)) return;
    if (Math.abs(x - p.tx) > 1 || Math.abs(y - p.ty) > 1) return; // só adjacente
    const tile = this.maps[p.map].tiles[y][x];
    if (tile === 4) return this.openChest(p, x, y);
    if (tile === 10) return this.takeFragment(p, x, y);
  }

  openChest(p, x, y) {
    const key = `${p.map}:${x},${y}`;
    if (this.chestsTaken.has(key)) return this.toast(p, 'O baú está vazio.');
    this.chestsTaken.add(key);
    // Conteúdo fixo por posição: mesmo baú, mesmo prêmio para todos.
    const gold = ri(30, 90);
    p.gold += gold; p.dirty = true;
    this.toast(p, `Você abriu o baú: +${gold} ouro.`);
    this.broadcastMap(p.map, { t: 'chest', x, y });
  }

  takeFragment(p, x, y) {
    if (p.quest.fragTaken) return;
    p.quest.fragTaken = true;
    this.addItem(p, 'fragment');
    p.dirty = true;
    this.toast(p, 'Você recolhe o Fragmento do Abismo. Algo distante percebeu você.');
  }

  cmdBuy(p, { npc, item }) {
    const list = SHOPS[npc];
    if (!list || !list.includes(item)) return;
    const near = NPCS.find((n) => n.id === npc && n.map === p.map);
    if (!near || Math.abs(near.x - p.tx) > 2 || Math.abs(near.y - p.ty) > 2) {
      return this.toast(p, 'Você precisa estar perto do vendedor.');
    }
    const it = ITEMS[item];
    if (!it || !it.price) return;
    if (p.gold < it.price) return this.toast(p, 'Ouro insuficiente.');
    p.gold -= it.price;
    this.addItem(p, item);
    p.dirty = true;
    this.toast(p, `Comprou ${it.name} por ${it.price} ouro.`);
  }

  cmdSell(p, { idx }) {
    const slot = p.inv[idx];
    if (!slot) return;
    const it = ITEMS[slot.id];
    if (!it || !it.price) return this.toast(p, 'Isso não tem valor de venda.');
    const valor = Math.floor(it.price / 2);
    this.consume(p, idx);
    p.gold += valor; p.dirty = true;
    this.toast(p, `Vendeu ${it.name} por ${valor} ouro.`);
  }

  // -------------------------------------------------------
  // Serviços da cidade
  // -------------------------------------------------------

  // Todo serviço exige estar ao lado de quem atende. Sem isso, um cliente
  // adulterado sacaria do banco do meio do cemitério.
  pertoDe(p, npcId, alcance = 2) {
    const n = NPCS.find((x) => x.id === npcId && x.map === p.map);
    if (!n) return null;
    if (Math.abs(n.x - p.tx) > alcance || Math.abs(n.y - p.ty) > alcance) return null;
    return n;
  }

  async cmdBanco(p, msg) {
    if (!BANCARIOS.some((id) => this.pertoDe(p, id))) {
      return this.toast(p, 'Você precisa estar no balcão do banco.');
    }
    const conta = await this.lerBanco(p.accountId);
    if (!conta) return this.toast(p, 'O caixa não encontrou sua conta.');

    const qtd = Math.floor(Number(msg.valor));
    switch (msg.acao) {
      case 'depositar': {
        if (!Number.isFinite(qtd) || qtd <= 0) return;
        const v = Math.min(qtd, p.gold);
        if (v <= 0) return this.toast(p, 'Você não tem ouro para depositar.');
        p.gold -= v; conta.gold += v; p.dirty = true;
        await this.gravarBanco(p.accountId, conta);
        this.toast(p, `Depositou ${v} ouro. Saldo: ${conta.gold}.`);
        break;
      }
      case 'sacar': {
        if (!Number.isFinite(qtd) || qtd <= 0) return;
        const v = Math.min(qtd, conta.gold);
        if (v <= 0) return this.toast(p, 'Seu saldo está zerado.');
        conta.gold -= v; p.gold += v; p.dirty = true;
        await this.gravarBanco(p.accountId, conta);
        this.toast(p, `Sacou ${v} ouro. Saldo: ${conta.gold}.`);
        break;
      }
      case 'guardar': {
        const slot = p.inv[msg.idx];
        if (!slot) return;
        if (conta.items.length >= 30) return this.toast(p, 'O cofre está cheio.');
        const it = ITEMS[slot.id];
        const pilha = it && it.stack && conta.items.find((s) => s.id === slot.id);
        if (pilha) pilha.qty += 1; else conta.items.push({ id: slot.id, qty: 1 });
        this.consume(p, msg.idx);
        await this.gravarBanco(p.accountId, conta);
        this.toast(p, `${it.name} guardado no cofre.`);
        break;
      }
      case 'retirar': {
        const slot = conta.items[msg.idx];
        if (!slot) return;
        if (p.inv.length >= 20) return this.toast(p, 'Sua mochila está cheia.');
        this.addItem(p, slot.id);
        if (slot.qty > 1) slot.qty -= 1; else conta.items.splice(msg.idx, 1);
        await this.gravarBanco(p.accountId, conta);
        this.toast(p, `${ITEMS[slot.id].name} retirado do cofre.`);
        break;
      }
      default:
        break;
    }
    this.sendTo(p, { t: 'banco', gold: conta.gold, items: conta.items });
  }

  async lerBanco(accountId) {
    try {
      const { rows } = await query(
        'SELECT bank_gold, bank_items FROM accounts WHERE id = $1', [Number(accountId)],
      );
      if (!rows[0]) return null;
      return { gold: rows[0].bank_gold, items: rows[0].bank_items || [] };
    } catch (err) {
      console.error('[banco] leitura falhou:', err.message);
      return null;
    }
  }

  async gravarBanco(accountId, conta) {
    try {
      await query(
        'UPDATE accounts SET bank_gold = $1, bank_items = $2::jsonb WHERE id = $3',
        [conta.gold, JSON.stringify(conta.items), Number(accountId)],
      );
    } catch (err) {
      console.error('[banco] gravação falhou:', err.message);
    }
  }

  cmdViajar(p, { destino }) {
    const cocheiro = Object.keys(ESTACOES).find((id) => this.pertoDe(p, id));
    if (!cocheiro) return this.toast(p, 'Procure um cocheiro para viajar.');
    if (!ESTACOES[cocheiro].includes(destino)) return this.toast(p, 'Essa rota não sai daqui.');
    const d = DESTINOS[destino];
    if (!d) return;
    if (p.gold < d.preco) return this.toast(p, `A passagem custa ${d.preco} ouro.`);
    p.gold -= d.preco; p.dirty = true;
    this.teleport(p, d);
    this.toast(p, `Você desembarca em ${d.nome}. (-${d.preco} ouro)`);
  }

  chat(p, text) {
    if (!p || typeof text !== 'string') return;
    const t = text.trim().slice(0, CHAT_MAX);
    if (!t) return;
    this.broadcastMap(p.map, { t: 'chat', from: p.nick, id: p.id, text: t });
  }

  // -------------------------------------------------------
  // Inventário
  // -------------------------------------------------------
  addItem(p, id) {
    const it = ITEMS[id];
    if (!it) return;
    if (it.stack) {
      const s = p.inv.find((x) => x.id === id);
      if (s) { s.qty += 1; p.dirty = true; return; }
    }
    if (p.inv.length >= 20) return this.toast(p, 'Mochila cheia!');
    p.inv.push({ id, qty: 1 });
    p.dirty = true;
  }

  consume(p, idx) {
    const s = p.inv[idx];
    if (!s) return;
    if (s.qty > 1) s.qty -= 1; else p.inv.splice(idx, 1);
    p.dirty = true;
  }

  // -------------------------------------------------------
  // Combate
  // -------------------------------------------------------
  damageMonster(m, dmg, byPlayer) {
    if (!m.alive) return;
    m.hp -= dmg;
    m.damage.set(byPlayer.charId, (m.damage.get(byPlayer.charId) || 0) + dmg);
    this.fx(m.map, { t: 'fx', kind: 'dmg', x: m.tx, y: m.ty, amount: dmg, on: m.id });
    if (m.hp > 0) return;

    m.alive = false;
    m.hp = 0;
    m.respawn = m.boss ? BOSS_RESPAWN_MS : RESPAWN_MS;
    const mt = MTYPES[m.type];

    // XP proporcional ao dano: quem só deu o último golpe não leva a presa
    // inteira, e ajudar de verdade compensa.
    const total = [...m.damage.values()].reduce((a, b) => a + b, 0) || 1;
    let topId = null, topDmg = -1;
    for (const [cid, d] of m.damage) {
      if (d > topDmg) { topDmg = d; topId = cid; }
      const pl = this.players.get(cid);
      if (!pl) continue;
      const share = Math.max(1, Math.round(mt.xp * (d / total)));
      this.gainXp(pl, share);
      this.fx(m.map, { t: 'fx', kind: 'xp', x: m.tx, y: m.ty, amount: share, to: pl.id });
    }

    const winner = topId ? this.players.get(topId) : null;
    if (winner) {
      const gold = ri(mt.gold[0], mt.gold[1]);
      winner.gold += gold; winner.dirty = true;
      let loot = '';
      for (const [id, chance] of mt.drops) {
        if (Math.random() < chance) { this.addItem(winner, id); loot += ` +${ITEMS[id].name}!`; }
      }
      this.toast(winner, `Você matou ${m.name}! (+${gold} ouro)${loot}`);
      if (m.type === 'gormak') winner.quest.gormakDead = true;
      if (m.type === 'corvus') winner.quest.priestDead = true;
    }

    m.damage.clear();
    for (const p of this.players.values()) if (p.target === m.id) p.target = null;
    this.broadcastMap(m.map, { t: 'kill', id: m.id, name: m.name, by: winner ? winner.nick : null });
  }

  gainXp(p, v) {
    p.xp += v; p.dirty = true;
    while (p.xp >= xpNeeded(p.level)) {
      p.level += 1;
      const st = this.stats(p);
      p.hp = st.hpMax; p.mp = st.mpMax;
      this.fx(p.map, { t: 'fx', kind: 'levelup', x: p.tx, y: p.ty, to: p.id, level: p.level });
      this.toast(p, `⭐ Você alcançou o nível ${p.level}!`);
    }
  }

  killPlayer(p) {
    p.dead = true; p.hp = 0; p.deadUntil = Date.now() + DEATH_MS;
    p.path = []; p.target = null; p.dirty = true;
    const perdido = Math.floor(p.xp * 0.1);
    p.xp = Math.max(0, p.xp - perdido);
    this.broadcastMap(p.map, { t: 'died', id: p.id, nick: p.nick });
    this.toast(p, `☠️ Você morreu. Perdeu ${perdido} XP.`);
  }

  revivePlayer(p) {
    // O templo registrado tem prioridade; sem ele, o da região onde morreu.
    const ponto = p.home || RESPAWN_POINTS[p.map] || RESPAWN_POINTS.over;
    const antes = p.map;
    p.map = ponto.map;
    const livre = this.nearestFree(ponto.map, ponto.x, ponto.y, p);
    p.tx = livre.x; p.ty = livre.y;
    const st = this.stats(p);
    p.hp = st.hpMax; p.mp = st.mpMax; p.dead = false; p.dirty = true;
    if (antes !== p.map) this.broadcastMap(antes, { t: 'left', id: p.id }, p.charId);
    this.sendMap(p);
    this.toast(p, 'Alguém o carregou de volta. Você acorda em segurança.');
  }

  // -------------------------------------------------------
  // Movimento e chegada
  // -------------------------------------------------------
  face(p, dx, dy) {
    if (dx === 1) p.dir = DIR.right;
    else if (dx === -1) p.dir = DIR.left;
    else if (dy === 1) p.dir = DIR.down;
    else if (dy === -1) p.dir = DIR.up;
  }

  onArrive(p) {
    // Pisar na porta do templo registra o ponto de renascimento. É
    // automático de propósito: obrigar a falar com alguém só faz o jogador
    // descobrir o sistema na hora errada — depois de morrer.
    for (const t of Object.values(TEMPLOS)) {
      if (t.map === p.map && t.x === p.tx && t.y === p.ty) {
        const jaEra = p.home && p.home.map === t.map && p.home.x === t.x && p.home.y === t.y;
        if (!jaEra) {
          p.home = { map: t.map, x: t.x, y: t.y, nome: t.nome };
          p.dirty = true;
          this.toast(p, `${t.nome}: seu ponto de renascimento foi registrado aqui.`);
        }
      }
    }
    // Portais pontuais (castelo, trono, floresta): disparam pela posição
    // exata, porque o tile 12 do over já pertence à mina.
    const salto = PORTAIS[`${p.map}:${p.tx},${p.ty}`];
    if (salto) return this.teleport(p, salto);

    const tile = this.maps[p.map].tiles[p.ty][p.tx];
    const link = PORTALS[p.map];
    if (tile === 12 && link && link.enter) return this.teleport(p, link.enter);
    if (tile === 11 && link && link.exit) return this.teleport(p, link.exit);
  }

  teleport(p, dest) {
    const antes = p.map;
    p.map = dest.map;
    const livre = this.nearestFree(dest.map, dest.x, dest.y, p);
    p.tx = livre.x; p.ty = livre.y;
    p.path = []; p.target = null; p.dirty = true;
    this.broadcastMap(antes, { t: 'left', id: p.id }, p.charId);
    this.sendMap(p);
  }

  // -------------------------------------------------------
  // Tick
  // -------------------------------------------------------
  tick() {
    const agora = Date.now();
    const dt = Math.min(500, agora - this.lastTick);
    this.lastTick = agora;

    // Só simulamos mapas com gente: monstro em mapa vazio não gasta CPU.
    const ativos = new Set([...this.players.values()].filter((p) => !p.dead).map((p) => p.map));

    this.updatePlayers(dt, agora);
    this.updateMonsters(dt, ativos);
    this.broadcastSnapshots();
    this.flushPrivate();
  }

  updatePlayers(dt, agora) {
    for (const p of this.players.values()) {
      if (p.dead) {
        if (agora >= p.deadUntil) this.revivePlayer(p);
        continue;
      }
      p.moveCd = Math.max(0, p.moveCd - dt);
      p.atkCd = Math.max(0, p.atkCd - dt);
      p.spellCd = Math.max(0, p.spellCd - dt);

      const cls = CLASSES[p.classId];
      const alvo = p.target ? this.monsters.find((m) => m.id === p.target) : null;
      const alvoValido = alvo && alvo.alive && alvo.map === p.map;
      if (p.target && !alvoValido) p.target = null;

      // Perseguir o alvo até entrar no alcance da classe.
      if (alvoValido) {
        const d = Math.max(Math.abs(alvo.tx - p.tx), Math.abs(alvo.ty - p.ty));
        if (d > cls.range && !p.path.length) {
          p.path = this.findPath(p.map, p.tx, p.ty, alvo.tx, alvo.ty, true);
        } else if (d <= cls.range) {
          p.path = [];
        }
      }

      if (p.moveCd === 0 && p.path.length) {
        const passo = p.path[0];
        const dx = passo.x - p.tx, dy = passo.y - p.ty;
        this.face(p, dx, dy);
        if (this.walkable(p.map, passo.x, passo.y, p)) {
          p.tx = passo.x; p.ty = passo.y; p.path.shift(); p.moveCd = MOVE_MS;
          this.onArrive(p);
        } else {
          // Alguém entrou na frente: replaneja uma vez em vez de travar.
          const fim = p.path[p.path.length - 1];
          p.path = this.findPath(p.map, p.tx, p.ty, fim.x, fim.y, !!alvoValido);
          if (!p.path.length) p.moveCd = MOVE_MS / 2;
        }
      }

      if (alvoValido && p.atkCd === 0) {
        const d = Math.max(Math.abs(alvo.tx - p.tx), Math.abs(alvo.ty - p.ty));
        if (d <= cls.range) {
          p.atkCd = cls.atkCd;
          this.face(p, Math.sign(alvo.tx - p.tx), Math.sign(alvo.ty - p.ty));
          const st = this.stats(p);
          const dano = ri(3, 8) + st.atk;
          if (cls.range > 1) this.fx(p.map, { t: 'fx', kind: 'shot', x: p.tx, y: p.ty, tx: alvo.tx, ty: alvo.ty });
          else this.fx(p.map, { t: 'fx', kind: 'slash', x: alvo.tx, y: alvo.ty });
          this.damageMonster(alvo, dano, p);
        }
      }

      const st = this.stats(p);
      const hpAntes = p.hp, mpAntes = p.mp;
      p.hp = Math.min(st.hpMax, p.hp + dt * 0.002);
      p.mp = Math.min(st.mpMax, p.mp + dt * 0.004);
      if (Math.floor(p.hp) !== Math.floor(hpAntes) || Math.floor(p.mp) !== Math.floor(mpAntes)) p.dirty = true;
    }
  }

  updateMonsters(dt, ativos) {
    for (const m of this.monsters) {
      if (!m.alive) {
        m.respawn -= dt;
        if (m.respawn <= 0 && this.walkable(m.map, m.sx, m.sy, m)) {
          m.alive = true; m.tx = m.sx; m.ty = m.sy; m.hp = m.hpMax; m.damage.clear();
        }
        continue;
      }
      if (!ativos.has(m.map)) continue;

      m.aiCd -= dt;
      if (m.aiCd > 0) continue;
      const mt = MTYPES[m.type];
      let vel = mt.speed;
      if (m.boss && m.hp < m.hpMax * 0.5) vel *= 0.65; // chefe enfurece
      m.aiCd = vel;

      // Persegue o jogador vivo mais próximo dentro do aggro.
      let alvo = null, melhor = Infinity;
      const raio = m.boss ? AGGRO_BOSS : AGGRO;
      for (const p of this.players.values()) {
        if (p.dead || p.map !== m.map) continue;
        const d = Math.abs(p.tx - m.tx) + Math.abs(p.ty - m.ty);
        if (d <= raio && d < melhor) { alvo = p; melhor = d; }
      }

      if (alvo) {
        const dx = alvo.tx - m.tx, dy = alvo.ty - m.ty;
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
          const st = this.stats(alvo);
          const dano = Math.max(1, ri(mt.dmg[0], mt.dmg[1]) - st.def);
          alvo.hp -= dano; alvo.dirty = true;
          m.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIR.right : DIR.left) : (dy > 0 ? DIR.down : DIR.up);
          this.fx(m.map, { t: 'fx', kind: 'hit', x: alvo.tx, y: alvo.ty, amount: dano, on: alvo.id });
          if (alvo.hp <= 0 && !alvo.dead) this.killPlayer(alvo);
        } else if (!m.static) {
          this.monsterStep(m, Math.sign(dx), Math.sign(dy));
        }
      } else if (!m.boss && !m.static && Math.random() < 0.5) {
        const [ddx, ddy] = [[0, -1], [0, 1], [-1, 0], [1, 0]][ri(0, 3)];
        // Vagar, mas sem se afastar mais que 4 tiles do ninho.
        if (Math.abs(m.tx + ddx - m.sx) <= 4 && Math.abs(m.ty + ddy - m.sy) <= 4) {
          this.monsterStep(m, ddx, ddy);
        }
      }
    }
  }

  monsterStep(m, dx, dy) {
    const tentar = Math.abs(dx) >= Math.abs(dy) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
    for (const [ax, ay] of tentar) {
      if (!ax && !ay) continue;
      if (ax === 1) m.dir = DIR.right; else if (ax === -1) m.dir = DIR.left;
      else if (ay === 1) m.dir = DIR.down; else if (ay === -1) m.dir = DIR.up;
      if (this.walkable(m.map, m.tx + ax, m.ty + ay, m)) { m.tx += ax; m.ty += ay; return true; }
    }
    return false;
  }

  // -------------------------------------------------------
  // Envio
  // -------------------------------------------------------
  sendTo(p, msg) {
    if (p.ws && p.ws.readyState === 1) {
      try { p.ws.send(JSON.stringify(msg)); } catch { /* socket morrendo */ }
    }
  }

  broadcastMap(map, msg, exceptCharId) {
    for (const p of this.players.values()) {
      if (p.map !== map || p.charId === exceptCharId) continue;
      this.sendTo(p, msg);
    }
  }

  fx(map, msg) { this.broadcastMap(map, msg); }

  toast(p, text) { if (p) this.sendTo(p, { t: 'log', text }); }

  sendMap(p) {
    const M = this.maps[p.map];
    this.sendTo(p, {
      t: 'map', map: p.map, name: M.name, w: M.w, h: M.h, dark: !!M.dark,
      x: p.tx, y: p.ty,
    });
  }

  snapshotFor(map) {
    const players = [];
    for (const p of this.players.values()) {
      if (p.map !== map) continue;
      players.push({
        id: p.id, nick: p.nick, cls: p.classId, sprite: p.sprite,
        x: p.tx, y: p.ty, d: p.dir, lvl: p.level,
        hp: Math.round(p.hp), hpMax: this.stats(p).hpMax, dead: p.dead,
      });
    }
    const monsters = [];
    for (const m of this.monsters) {
      if (m.map !== map || !m.alive) continue;
      monsters.push({
        id: m.id, type: m.type, sprite: m.sprite, scale: m.scale, name: m.name,
        x: m.tx, y: m.ty, d: m.dir, hp: m.hp, hpMax: m.hpMax, boss: m.boss,
      });
    }
    return { t: 'snap', players, monsters };
  }

  broadcastSnapshots() {
    const mapas = new Set([...this.players.values()].map((p) => p.map));
    for (const map of mapas) {
      const snap = this.snapshotFor(map);
      const texto = JSON.stringify(snap);
      for (const p of this.players.values()) {
        if (p.map !== map) continue;
        if (p.ws && p.ws.readyState === 1) {
          try { p.ws.send(texto); } catch { /* ignora */ }
        }
      }
    }
  }

  // Estado privado (vida, mana, XP, mochila) só vai para o dono, e só
  // quando muda — não faz sentido repetir a mochila 10x por segundo.
  flushPrivate() {
    for (const p of this.players.values()) {
      if (!p.dirty) continue;
      p.dirty = false;
      const st = this.stats(p);
      this.sendTo(p, {
        t: 'you', id: p.id, nick: p.nick, cls: p.classId,
        level: p.level, xp: p.xp, xpNext: xpNeeded(p.level), gold: p.gold,
        hp: Math.round(p.hp), hpMax: st.hpMax, mp: Math.round(p.mp), mpMax: st.mpMax,
        atk: st.atk, def: st.def, dead: p.dead, spellCd: Math.round(p.spellCd),
        home: p.home,
        inv: p.inv, eq: p.eq, quest: p.quest,
      });
    }
  }

  // -------------------------------------------------------
  // Persistência
  // -------------------------------------------------------
  async save(p) {
    try {
      await query(
        `UPDATE characters SET level=$1, xp=$2, gold=$3, hp=$4, mp=$5, map=$6, tx=$7, ty=$8,
                inventory=$9::jsonb, equipment=$10::jsonb, quest=$11::jsonb,
                home=$12::jsonb, last_played_at=now()
          WHERE id=$13`,
        [p.level, p.xp, p.gold, Math.round(p.hp), Math.round(p.mp), p.map, p.tx, p.ty,
         JSON.stringify(p.inv), JSON.stringify(p.eq), JSON.stringify(p.quest),
         p.home ? JSON.stringify(p.home) : null, Number(p.charId)],
      );
    } catch (err) {
      console.error('[game] falha ao salvar', p.nick, '-', err.message);
    }
  }

  async saveAll() {
    for (const p of this.players.values()) await this.save(p);
  }
}
