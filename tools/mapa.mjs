// Desenha um mapa em ASCII no terminal e valida posições de conteúdo.
// Uso:  node tools/mapa.mjs vale
//       node tools/mapa.mjs vale 8 4 52 40     (recorte)

import { buildWorld, BLOCK } from '../public/shared/world.js';
import { NPCS, SPAWNS, PORTALS, RESPAWN_POINTS, SHOPS } from '../public/shared/content.js';

const SIMBOLO = {
  0: '.', 1: ',', 2: '~', 3: 'T', 4: '$', 5: ':', 6: '#', 7: 'o', 8: '%',
  9: 'E', 10: '*', 11: '<', 12: '>', 13: 'M', 14: 'B', 15: '+', 16: '!',
  17: 'H', 18: '=', 19: 'x',
};

const mapa = process.argv[2] || 'vale';
const MAPS = buildWorld();
const M = MAPS[mapa];
if (!M) { console.log('mapas:', Object.keys(MAPS).join(', ')); process.exit(1); }

const x0 = Number(process.argv[3] ?? 0), y0 = Number(process.argv[4] ?? 0);
const x1 = Number(process.argv[5] ?? M.w) - 1, y1 = Number(process.argv[6] ?? M.h) - 1;

// sobreposições
const marca = new Map();
const por = (x, y, c) => marca.set(`${x},${y}`, c);
for (const n of NPCS) if (n.map === mapa) por(n.x, n.y, SHOPS[n.id] ? '§' : 'N');
for (const [tipo, mp, x, y] of SPAWNS) if (mp === mapa) por(x, y, tipo === 'corvus' || tipo === 'gormak' ? 'Ω' : 'm');
if (M.boat) por(M.boat.x, M.boat.y, 'b');

console.log(`\n=== ${M.name} (${mapa}) ${M.w}x${M.h} ===`);
console.log('. grama  , terra  = calçada  ~ água  : areia  T árvore  H prédio  M muralha');
console.log('# parede o rocha  + túmulo  ! placa  B estante  $ baú  x objeto  > entra  < sai');
console.log('N npc  § loja  m monstro  Ω chefe  b barco\n');

let cab = '    ';
for (let x = x0; x <= x1; x++) cab += x % 10 === 0 ? String((x / 10) % 10) : ' ';
console.log(cab);
for (let y = y0; y <= y1; y++) {
  let linha = String(y).padStart(3) + ' ';
  for (let x = x0; x <= x1; x++) {
    linha += marca.get(`${x},${y}`) || SIMBOLO[M.tiles[y][x]] || '?';
  }
  console.log(linha);
}

// ---------- validação ----------
console.log('\n=== VALIDAÇÃO ===');
const problemas = [];
const andavel = (mp, x, y) => {
  const MM = MAPS[mp];
  if (!MM || x < 0 || y < 0 || x >= MM.w || y >= MM.h) return false;
  return !BLOCK.has(MM.tiles[y][x]);
};

for (const n of NPCS) {
  // O NPC ocupa o tile, então ele precisa de chão sob os pés e um vizinho livre.
  if (BLOCK.has(MAPS[n.map].tiles[n.y][n.x])) problemas.push(`NPC ${n.id} em tile bloqueado (${n.map} ${n.x},${n.y})`);
  const viz = [[0,1],[0,-1],[1,0],[-1,0]].some(([dx,dy]) => andavel(n.map, n.x+dx, n.y+dy));
  if (!viz) problemas.push(`NPC ${n.id} sem vizinho acessível (${n.map} ${n.x},${n.y})`);
}
for (const [tipo, mp, x, y] of SPAWNS) {
  if (!andavel(mp, x, y)) problemas.push(`spawn ${tipo} em tile bloqueado (${mp} ${x},${y})`);
}
for (const [mp, links] of Object.entries(PORTALS)) {
  for (const [tipo, d] of Object.entries(links)) {
    if (!andavel(d.map, d.x, d.y)) problemas.push(`portal ${mp}.${tipo} chega em tile bloqueado (${d.map} ${d.x},${d.y})`);
  }
}
for (const [mp, d] of Object.entries(RESPAWN_POINTS)) {
  if (!andavel(d.map, d.x, d.y)) problemas.push(`respawn de ${mp} em tile bloqueado (${d.map} ${d.x},${d.y})`);
}

// conectividade: tudo que importa precisa ser alcançável a partir do nascimento
function alcancavel(mp, sx, sy) {
  const MM = MAPS[mp];
  const vis = new Set([sy * MM.w + sx]);
  const fila = [[sx, sy]];
  for (let i = 0; i < fila.length; i++) {
    const [cx, cy] = fila[i];
    for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!andavel(mp, nx, ny)) continue;
      const k = ny * MM.w + nx;
      if (vis.has(k)) continue;
      vis.add(k); fila.push([nx, ny]);
    }
  }
  return vis;
}

for (const [mp, ponto] of Object.entries(RESPAWN_POINTS)) {
  if (ponto.map !== mp) continue;
  const vis = alcancavel(ponto.map, ponto.x, ponto.y);
  for (const n of NPCS.filter((n) => n.map === mp)) {
    const perto = [[0,1],[0,-1],[1,0],[-1,0]].some(([dx,dy]) => vis.has((n.y+dy) * MAPS[mp].w + (n.x+dx)));
    if (!perto) problemas.push(`NPC ${n.id} inalcançável a partir do nascimento em ${mp}`);
  }
  for (const [tipo, mm, x, y] of SPAWNS.filter((s) => s[1] === mp)) {
    if (!vis.has(y * MAPS[mp].w + x)) problemas.push(`spawn ${tipo} (${x},${y}) inalcançável em ${mp}`);
  }
  const MM = MAPS[mp];
  let livres = 0;
  for (let y = 0; y < MM.h; y++) for (let x = 0; x < MM.w; x++) if (!BLOCK.has(MM.tiles[y][x])) livres++;
  console.log(`${mp}: ${vis.size} de ${livres} tiles livres alcançáveis a partir do nascimento`);
}

if (problemas.length) {
  console.log(`\n${problemas.length} PROBLEMA(S):`);
  for (const p of problemas) console.log('  -', p);
  process.exit(1);
}
console.log('\nnenhum problema encontrado.');

// Um NPC parado no tile do templo impede o jogador de pisar nele e
// registrar o renascimento — foi exatamente o que aconteceu na primeira
// versão. Esta checagem existe para não acontecer de novo.
{
  const { TEMPLOS: TT } = await import('../public/shared/content.js');
  const ruins = [];
  for (const [id, t] of Object.entries(TT)) {
    const ocupado = NPCS.find((n) => n.map === t.map && n.x === t.x && n.y === t.y);
    if (ocupado) ruins.push(`templo ${id} (${t.map} ${t.x},${t.y}) está sob o NPC ${ocupado.id}`);
    if (BLOCK.has(MAPS[t.map].tiles[t.y][t.x])) ruins.push(`templo ${id} em tile bloqueado`);
  }
  if (ruins.length) { console.log('\nPROBLEMA NOS TEMPLOS:'); for (const r of ruins) console.log('  -', r); process.exit(1); }
  console.log('templos: livres e pisáveis.');
}
