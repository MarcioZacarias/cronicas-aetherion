// =========================================================
// Mundo de Aetherion — módulo compartilhado servidor/cliente.
//
// O servidor é autoritativo sobre entidades (jogadores, monstros,
// combate), mas os MAPAS são conteúdo estático: em vez de trafegar
// tiles pela rede a cada login, ambos os lados constroem o mesmo mundo
// a partir de uma semente fixa. Por isso NADA aqui pode usar
// Math.random() — só o rng semeado abaixo.
// =========================================================

export const TILE = 32;
export const DIR = { up: 0, left: 1, down: 2, right: 3 };

// 0 grama  1 terra  2 água  3 árvore  4 baú     5 areia
// 6 parede 7 rocha  8 rachada 9 porta-eclipse  10 fragmento
// 11 portal-saída  12 portal-entrada  13 muralha  14 estante
// 15 túmulo  16 placa
export const BLOCK = new Set([2, 3, 4, 6, 7, 8, 9, 13, 14, 15, 16]);

export const WORLD_SEED = 0x41455448; // "AETH" — fixa: mudá-la muda o mundo.

// mulberry32: determinístico, rápido e idêntico em Node e no navegador.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildWorld() {
  const rng = makeRng(WORLD_SEED);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const MAPS = {};

  function makeMap(w, h, fill) {
    const tiles = [], deco = [];
    for (let y = 0; y < h; y++) {
      tiles[y] = []; deco[y] = [];
      for (let x = 0; x < w; x++) { tiles[y][x] = fill; deco[y][x] = ri(0, 2); }
    }
    return { w, h, tiles, deco, houses: [], chapels: [] };
  }

  // ---------- Ilha de Aurora (overworld) ----------
  {
    const m = makeMap(40, 32, 0), T = m.tiles;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 40; x++) {
      const b = Math.min(x, y, 39 - x, 31 - y);
      if (b < 2) T[y][x] = 2; else if (b < 3) T[y][x] = 5;
    }
    for (let y = 21; y < 28; y++) for (let x = 27; x < 37; x++)
      if (T[y][x] === 0 && rng() < 0.22) T[y][x] = 2;
    [[5,5],[7,4],[9,6],[4,8],[6,9],[8,8],[11,5],[12,8],[5,12],[8,12],[10,11],[13,11],
     [4,15],[7,15],[11,14],[14,14],[25,10],[27,12],[30,9],[33,11],[35,8],[24,14],
     [29,15],[34,15],[6,18],[4,20],[25,19],[27,21],[35,20],[33,24],[5,24],[4,27],
     [24,27],[36,26],[12,16],[15,12],[22,12]]
      .forEach(([x, y]) => { if (T[y][x] === 0) T[y][x] = 3; });
    [[15,2],[16,2],[20,2],[21,2],[15,3],[21,3],[15,5],[21,5],[16,6],[20,6]]
      .forEach(([x, y]) => { if (T[y][x] !== 2) T[y][x] = 7; });
    for (let y = 3; y < 6; y++) for (let x = 17; x < 20; x++) T[y][x] = 12;
    for (let y = 19; y < 27; y++) for (let x = 7; x < 22; x++) if (T[y][x] === 0) T[y][x] = 1;
    for (let y = 6; y < 19; y++) if (T[y][18] !== 2) T[y][18] = 1;
    for (let y = 27; y < 30; y++) if (T[y][14] !== 2) T[y][14] = 1;
    T[28][4] = 4; T[4][35] = 4;
    m.houses = [{ x: 8, y: 16, img: 'house' }, { x: 15, y: 16, img: 'house' }, { x: 10, y: 21, img: 'house' }];
    m.houses.forEach(h => { for (let yy = h.y + 3; yy < h.y + 5; yy++) for (let xx = h.x; xx < h.x + 5; xx++) T[yy][xx] = 6; });
    m.holeAnchor = { x: 17, y: 3 };
    m.boat = { x: 21, y: 29 };
    m.name = 'Ilha de Aurora';
    MAPS.over = m;
  }

  // ---------- Valedorn ----------
  {
    const m = makeMap(44, 34, 0), T = m.tiles;
    for (let y = 0; y < 34; y++) for (let x = 0; x < 44; x++)
      if (Math.min(x, y, 43 - x, 33 - y) < 2) T[y][x] = 2;
    for (let x = 4; x <= 19; x++) { T[4][x] = 13; T[14][x] = 13; }
    for (let y = 4; y <= 14; y++) { T[y][4] = 13; T[y][19] = 13; }
    T[14][11] = 1; T[14][12] = 1;
    for (let y = 5; y < 14; y++) for (let x = 5; x < 19; x++) T[y][x] = 1;
    m.houses = [{ x: 5, y: 5, img: 'house2' }, { x: 13, y: 5, img: 'house' }];
    m.houses.forEach(h => { for (let yy = h.y + 3; yy < h.y + 5; yy++) for (let xx = h.x; xx < h.x + 5; xx++) T[yy][xx] = 6; });
    T[10][6] = 14; T[10][8] = 14;
    for (let y = 15; y < 31; y++) { T[y][11] = 1; T[y][12] = 1; }
    for (let x = 13; x < 21; x++) T[30][x] = 1;
    [[22,7],[26,10],[30,7],[24,14],[29,16],[21,12],[32,12]]
      .forEach(([x, y]) => { if (T[y][x] === 0) T[y][x] = 3; });
    for (let y = 4; y < 21; y++) for (let x = 33; x < 42; x++)
      if (T[y][x] === 0 && (x + y * 3) % 4 !== 0 && rng() < 0.55) T[y][x] = 3;
    [[34,7],[37,12],[35,16],[40,10],[38,17],[40,7],[39,6]]
      .forEach(([x, y]) => { if (T[y][x] === 3) T[y][x] = 0; });
    T[6][40] = 4;
    [[6,22],[8,24],[13,22],[15,24],[7,27],[10,28],[14,27],[16,26],[5,25],[12,25],[16,29],[8,30]]
      .forEach(([x, y]) => { if (T[y][x] === 0) T[y][x] = 15; });
    T[29][5] = 4;
    m.houses.push({ x: 14, y: 16, img: 'house' });
    for (let yy = 19; yy < 21; yy++) for (let xx = 14; xx < 19; xx++) T[yy][xx] = 6;
    T[15][13] = 16; T[29][19] = 16; T[21][12] = 16; T[10][32] = 16;
    m.chapels = [{ x: 9, y: 20 }];
    m.chapels.forEach(h => { for (let yy = h.y + 3; yy < h.y + 5; yy++) for (let xx = h.x; xx < h.x + 5; xx++) T[yy][xx] = 6; });
    T[25][11] = 12;
    m.boat = { x: 21, y: 31 };
    m.name = 'Valedorn';
    MAPS.vale = m;
  }

  // ---------- Minas de Aurora ----------
  {
    const m = makeMap(30, 26, 6), T = m.tiles;
    const carve = (x, y, w, h) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) T[yy][xx] = 1; };
    carve(5,1,5,2); carve(3,4,9,5); carve(12,6,4,1); carve(16,3,12,6);
    carve(21,9,2,4); carve(4,12,23,4); carve(1,13,2,2); carve(15,16,1,3); carve(11,19,9,5);
    T[1][7] = 10; T[3][7] = 9; T[13][3] = 8; T[14][1] = 4; T[3][27] = 4; T[22][15] = 11;
    [[8,13],[14,13],[19,15],[24,12],[18,5],[24,7],[13,21]]
      .forEach(([x, y]) => { if (T[y][x] === 1) T[y][x] = 7; });
    m.dark = true;
    m.name = 'Minas de Aurora';
    MAPS.mine = m;
  }

  // ---------- Catacumbas ----------
  {
    const m = makeMap(30, 22, 6), T = m.tiles;
    const carve = (x, y, w, h) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) T[yy][xx] = 1; };
    carve(13,17,4,4); carve(14,12,2,5); carve(8,8,14,4); carve(4,4,6,8);
    carve(22,6,5,6); carve(10,2,10,5); carve(14,6,2,2); carve(5,1,3,2);
    T[3][6] = 8; T[1][6] = 4; T[19][14] = 11; T[6][26] = 14; T[11][26] = 4;
    [[5,6],[8,5],[4,9],[9,10],[23,7],[25,9]].forEach(([x, y]) => { if (T[y][x] === 1) T[y][x] = 15; });
    [[11,10],[19,9],[16,13]].forEach(([x, y]) => { if (T[y][x] === 1) T[y][x] = 7; });
    m.altar = { x: 14, y: 4 };
    m.dark = true;
    m.name = 'Catacumbas de Ardentia';
    MAPS.cata = m;
  }

  return MAPS;
}
