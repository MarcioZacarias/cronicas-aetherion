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

// 0 grama   1 terra    2 água     3 árvore   4 baú      5 areia
// 6 parede  7 rocha    8 rachada  9 porta-eclipse       10 fragmento
// 11 portal-saída      12 portal-entrada     13 muralha 14 estante
// 15 túmulo 16 placa   17 prédio  18 calçamento         19 objeto
export const BLOCK = new Set([2, 3, 4, 6, 7, 8, 9, 13, 14, 15, 16, 17, 19]);

export const WORLD_SEED = 0x41455448; // "AETH" — mudá-la muda o mundo.

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

// Variantes de fachada disponíveis no atlas gerado (city.png).
export const VARIANTES_PREDIO = ['house', 'house2', 'chapel'];

export function buildWorld() {
  const rng = makeRng(WORLD_SEED);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const escolha = (arr) => arr[Math.floor(rng() * arr.length)];
  const MAPS = {};

  function makeMap(w, h, fill) {
    const tiles = [], deco = [];
    for (let y = 0; y < h; y++) {
      tiles[y] = []; deco[y] = [];
      for (let x = 0; x < w; x++) { tiles[y][x] = fill; deco[y][x] = ri(0, 2); }
    }
    // `res` marca terreno reservado (ruas, praça, mercado, lotes já
    // destinados). Sem isso, um quarteirão colocado antes seria apagado
    // pela praça desenhada depois e a fachada ficaria flutuando sobre o
    // calçamento. É andaime de construção: some antes de devolver o mapa.
    const res = [];
    for (let y = 0; y < h; y++) res[y] = new Array(w).fill(false);
    return { w, h, tiles, deco, buildings: [], props: [], res };
  }

  const dentro = (m, x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h;

  function preencher(m, x0, y0, x1, y1, t) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (dentro(m, x, y)) m.tiles[y][x] = t;
    }
  }

  // Reserva um retângulo: nenhum prédio será erguido ali depois.
  function reservar(m, x0, y0, x1, y1, t) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!dentro(m, x, y)) continue;
      m.res[y][x] = true;
      if (t !== undefined) m.tiles[y][x] = t;
    }
  }

  // ---------------------------------------------------------
  // Prédios
  //
  // Um prédio ocupa um retângulo inteiro e é sólido: a fachada é vista de
  // frente, então o "miolo" não é chão. O cliente desenha a partir das
  // peças do atlas; aqui só registramos a forma e marcamos a colisão.
  // ---------------------------------------------------------
  function predio(m, x, y, w, h, variante, opts = {}) {
    if (x < 0 || y < 0 || x + w > m.w || y + h > m.h) return null;
    // Uma fachada precisa de topo + cornija + 2 linhas de base.
    if (w < 2 || h < 4) return null;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (m.tiles[yy][xx] === 17) return null;        // não empilha em outro prédio
      if (m.res[yy][xx] && !opts.emReserva) return null; // não invade rua nem praça
    }
    const porta = opts.porta !== undefined ? opts.porta : Math.floor(w / 2);
    const b = {
      x, y, w, h,
      v: variante || escolha(VARIANTES_PREDIO),
      porta,        // coluna (relativa) onde fica a porta
      janelas: [],  // colunas com janela no térreo
      altas: [],    // colunas com janela no andar de cima
    };
    // Janelas na faixa da base, em toda coluna que não é porta nem quina.
    for (let i = 1; i < w - 1; i++) if (i !== porta && rng() < 0.75) b.janelas.push(i);
    // No andar de cima, alinhadas com as de baixo — inclusive sobre a porta,
    // que é como uma fachada de verdade se organiza.
    for (let i = 1; i < w - 1; i++) if (rng() < 0.8) b.altas.push(i);
    preencher(m, x, y, x + w - 1, y + h - 1, 17);
    m.buildings.push(b);
    return b;
  }

  // `sobrePedra` é para o que nasce em cima de estrutura sólida — torres na
  // quina da muralha, por exemplo. Sem ele, mobiliário só vai em chão livre:
  // sem essa guarda, um lampião posto por um laço genérico acaba dentro de
  // uma parede ou de um prédio.
  function objeto(m, tipo, x, y, { bloqueia = true, sobrePedra = false } = {}) {
    if (!dentro(m, x, y)) return false;
    if (!sobrePedra && BLOCK.has(m.tiles[y][x])) return false;
    // Guarda o chão que havia ali: o tile vira 19 (objeto) para bloquear a
    // passagem, e sem isso o cliente não saberia se desenhar grama ou
    // calçamento sob o barril.
    m.props.push({ t: tipo, x, y, chao: m.tiles[y][x] });
    if (bloqueia && !sobrePedra) m.tiles[y][x] = 19;
    return true;
  }

  // Mata gerada por sorteio fecha clareiras sem querer: sobram tufos de
  // chão livre cercados de árvore, onde um monstro nasce e nunca é
  // alcançado. Esta passada derruba o MÍNIMO de árvores para ligar tudo —
  // e só derruba árvore, nunca muralha, prédio ou rocha.
  function garantirConexao(m, semX, semY) {
    const idx = (x, y) => y * m.w + x;
    const livre = (x, y) => dentro(m, x, y) && !BLOCK.has(m.tiles[y][x]);
    const alcancado = new Set();

    const inundar = () => {
      alcancado.clear();
      if (!livre(semX, semY)) return;
      alcancado.add(idx(semX, semY));
      const fila = [[semX, semY]];
      for (let i = 0; i < fila.length; i++) {
        const [cx, cy] = fila[i];
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nx = cx + dx, ny = cy + dy;
          if (!livre(nx, ny)) continue;
          const k = idx(nx, ny);
          if (alcancado.has(k)) continue;
          alcancado.add(k); fila.push([nx, ny]);
        }
      }
    };

    inundar();
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (BLOCK.has(m.tiles[y][x]) || alcancado.has(idx(x, y))) continue;
      // Abre para oeste até esbarrar em terreno já conectado.
      for (let xx = x - 1; xx >= 0; xx--) {
        if (alcancado.has(idx(xx, y))) break;
        if (m.tiles[y][xx] === 3) m.tiles[y][xx] = 0;
        else if (BLOCK.has(m.tiles[y][xx])) break;
      }
      inundar();
    }
  }

  // Objeto que ocupa mais de um tile. Só o canto superior esquerdo vira
  // prop desenhável; os demais tiles apenas bloqueiam, senão a fonte seria
  // desenhada quatro vezes, uma por tile.
  function objetoGrande(m, tipo, x, y, w, h) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (!dentro(m, xx, yy) || BLOCK.has(m.tiles[yy][xx])) return false;
    }
    const chao = m.tiles[y][x];
    m.props.push({ t: tipo, x, y, w, h, chao });
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (xx !== x || yy !== y) m.props.push({ t: '_vazio', x: xx, y: yy, chao: m.tiles[yy][xx] });
      m.tiles[yy][xx] = 19;
    }
    return true;
  }

  // Enfileira prédios ao longo de uma faixa, deixando ruelas entre eles.
  // `baseY` é a linha do chão: os prédios crescem para cima a partir dela.
  function quarteirao(m, x0, x1, baseY, opts = {}) {
    const minW = opts.minW || 4, maxW = opts.maxW || 7;
    const minH = opts.minH || 5, maxH = opts.maxH || 6;
    let x = x0;
    const feitos = [];
    while (x + minW - 1 <= x1) {
      const w = Math.min(ri(minW, maxW), x1 - x + 1);
      if (w < minW) break;
      const h = ri(minH, maxH);
      const b = predio(m, x, baseY - h + 1, w, h, opts.variante);
      if (b) { feitos.push(b); x += w + ri(1, 2); } // ruela entre prédios
      else x += 1; // esbarrou em rua/praça: anda um tile e tenta de novo
    }
    return feitos;
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
     [24,27],[36,26],[15,12],[22,12]]
      .forEach(([x, y]) => { if (T[y][x] === 0) T[y][x] = 3; });
    [[15,2],[16,2],[20,2],[21,2],[15,3],[21,3],[15,5],[21,5],[16,6],[20,6]]
      .forEach(([x, y]) => { if (T[y][x] !== 2) T[y][x] = 7; });
    for (let y = 3; y < 6; y++) for (let x = 17; x < 20; x++) T[y][x] = 12;

    // --- Vila de Lumera ---
    // Terreiro de terra batida com duas ruas calçadas. As ruas são
    // reservadas antes dos prédios, senão as casas as invadiriam.
    preencher(m, 5, 16, 23, 29, 1);
    reservar(m, 5, 21, 23, 23, 18);      // rua principal (leste-oeste)
    reservar(m, 13, 16, 14, 29, 18);     // rua do porto (norte-sul)
    reservar(m, 5, 29, 23, 29, 1);       // beira sul livre
    // A borda norte NÃO é reservada de propósito: as casas da fileira de
    // cima começam em y=16, e reservá-la deixava o quarteirão inteiro vazio.
    for (let y = 6; y < 16; y++) if (T[y][18] !== 2) T[y][18] = 1; // trilha às minas
    reservar(m, 18, 6, 18, 16, 1);
    T[30][14] = 18; T[31][14] = 18;      // descida para o porto

    quarteirao(m, 6, 12, 20, { minW: 4, maxW: 5, minH: 5, maxH: 5 });
    quarteirao(m, 15, 23, 20, { minW: 4, maxW: 5, minH: 5, maxH: 5 });
    quarteirao(m, 6, 12, 28, { minW: 4, maxW: 5, minH: 5, maxH: 5 });
    quarteirao(m, 15, 23, 28, { minW: 4, maxW: 5, minH: 5, maxH: 5 });

    objeto(m, 'poco', 16, 22);
    objeto(m, 'lampiao', 11, 22); objeto(m, 'lampiao', 20, 22);
    objeto(m, 'engradado', 8, 22); objeto(m, 'barril', 9, 22);
    objeto(m, 'barril', 22, 22);
    objeto(m, 'banca', 10, 22); objeto(m, 'banca', 19, 22);

    T[28][4] = 4; T[4][35] = 4;
    m.holeAnchor = { x: 17, y: 3 };
    m.boat = { x: 14, y: 30 };
    m.name = 'Ilha de Aurora';
    MAPS.over = m;
  }

  // ---------- Valedorn ----------
  // Mapa grande para caber Ardentia de verdade: muralhas, avenida, praça
  // com fonte, mercado, quatro fileiras de quarteirões e o porto ao sul.
  {
    const m = makeMap(80, 60, 0), T = m.tiles;
    for (let y = 0; y < 60; y++) for (let x = 0; x < 80; x++) {
      const b = Math.min(x, y, 79 - x, 59 - y);
      if (b < 2) T[y][x] = 2; else if (b < 3) T[y][x] = 5;
    }

    // ===== Ardentia: muralhas de x=8..52, y=4..38 =====
    const MX0 = 8, MX1 = 52, MY0 = 4, MY1 = 38;
    preencher(m, MX0 + 1, MY0 + 1, MX1 - 1, MY1 - 1, 18); // tudo calçado
    for (let x = MX0; x <= MX1; x++) { T[MY0][x] = 13; T[MY1][x] = 13; }
    for (let y = MY0; y <= MY1; y++) { T[y][MX0] = 13; T[y][MX1] = 13; }
    T[MY1][29] = 18; T[MY1][30] = 18; // portão sul
    T[MY0][29] = 18; T[MY0][30] = 18; // portão norte (para os campos)

    // Torres nas quinas — dão silhueta à muralha.
    for (const [tx, ty] of [[MX0, MY0], [MX1, MY0], [MX0, MY1], [MX1, MY1],
                            [MX0, 21], [MX1, 21], [21, MY0], [38, MY0], [21, MY1], [38, MY1]]) {
      objeto(m, 'torre', tx, ty, { sobrePedra: true });
    }

    // --- O traçado vem ANTES dos prédios ---
    // Avenida principal (norte-sul), duas travessas e a faixa junto às
    // muralhas, para ninguém ficar preso entre fachada e muro.
    reservar(m, 28, MY0 + 1, 31, MY1 - 1, 18);
    reservar(m, MX0 + 1, 12, MX1 - 1, 13, 18);
    reservar(m, MX0 + 1, 30, MX1 - 1, 31, 18);
    reservar(m, MX0 + 1, MY0 + 1, MX1 - 1, MY0 + 1, 18);
    reservar(m, MX0 + 1, MY1 - 1, MX1 - 1, MY1 - 1, 18);
    reservar(m, MX0 + 1, MY0 + 1, MX0 + 1, MY1 - 1, 18);
    reservar(m, MX1 - 1, MY0 + 1, MX1 - 1, MY1 - 1, 18);

    // Praça central e mercado, também reservados antes de construir.
    reservar(m, 22, 20, 36, 28, 18);
    reservar(m, 38, 20, 48, 28, 18);
    // Lotes da catedral e da biblioteca.
    reservar(m, 24, 5, 35, 11);
    reservar(m, 12, 15, 20, 19, 18);

    // ===== Catedral: fachada larga e alta no fim da avenida =====
    predio(m, 25, 5, 10, 7, 'chapel', { porta: 5, luz: 2, emReserva: true });
    objeto(m, 'lampiao', 24, 11); objeto(m, 'lampiao', 35, 11);

    // ===== Biblioteca: estantes à vista, sem parede na frente =====
    T[17][13] = 14; T[17][15] = 14; T[17][17] = 14; T[17][19] = 14;

    // ===== Quarteirões =====
    // Quatro fileiras de norte a sul; o que esbarra em rua ou praça é
    // pulado automaticamente pelo quarteirao(). A fileira sul tem base em
    // 36 porque a linha 37 é a faixa livre junto à muralha.
    for (const baseY of [11, 19, 29, 36]) {
      quarteirao(m, MX0 + 2, 27, baseY);
      quarteirao(m, 32, MX1 - 2, baseY);
    }
    // Bairro sul: mais uma fileira encostada na travessa, para o quarteirão
    // entre a praça e a muralha não ficar vazio.
    quarteirao(m, MX0 + 2, 21, 29, { minW: 4, maxW: 6 });
    quarteirao(m, 32, MX1 - 2, 36, { minW: 4, maxW: 6 });

    // ===== Mobiliário urbano =====
    objetoGrande(m, 'fonte', 28, 23, 2, 2);
    for (const x of [24, 34]) for (const y of [21, 27]) objeto(m, 'lampiao', x, y);
    // Canteiros de grama quebram o cinza do calçamento.
    for (const [gx, gy] of [[22, 21], [23, 21], [22, 27], [23, 27], [35, 21], [36, 21], [35, 27], [36, 27]]) {
      if (m.tiles[gy][gx] === 18) m.tiles[gy][gx] = 0;
    }
    objeto(m, 'arvorinha', 22, 22); objeto(m, 'arvorinha', 36, 22);
    objeto(m, 'arvorinha', 22, 26); objeto(m, 'arvorinha', 36, 26);
    for (let i = 0; i < 5; i++) objeto(m, 'banca', 39 + i * 2, 22);
    for (let i = 0; i < 4; i++) objeto(m, 'banca', 40 + i * 2, 26);
    objeto(m, 'engradado', 39, 24); objeto(m, 'barril', 40, 24);
    objeto(m, 'engradado', 47, 24); objeto(m, 'barril', 46, 24);
    objeto(m, 'engradado', 43, 20); objeto(m, 'barril', 44, 20);
    objeto(m, 'barril', 39, 28); objeto(m, 'engradado', 47, 28);
    // Lampiões ao longo da avenida.
    for (let y = 7; y <= 35; y += 7) { objeto(m, 'lampiao', 27, y); objeto(m, 'lampiao', 32, y); }
    // A praça é grande: sem mobiliário no miolo ela vira um descampado de
    // pedra. Bancos e postes dão escala e caminho para o olho.
    for (const x of [25, 33]) { objeto(m, 'banco', x, 22); objeto(m, 'banco', x, 26); }
    objeto(m, 'banco', 27, 20); objeto(m, 'banco', 30, 20);
    objeto(m, 'banco', 27, 28); objeto(m, 'banco', 30, 28);
    objeto(m, 'lampiao', 26, 24); objeto(m, 'lampiao', 31, 24);
    // Feira encostada na praça, ligando-a ao mercado.
    objeto(m, 'banca', 37, 22); objeto(m, 'banca', 37, 26);

    // ===== Fora das muralhas =====
    // Estrada do portão sul até o porto.
    preencher(m, 29, MY1 + 1, 30, 53, 1);
    preencher(m, 27, 53, 40, 54, 1);
    // Estalagem do Viajante, à beira da estrada.
    predio(m, 33, 41, 6, 5, 'house2', { porta: 3 });
    objeto(m, 'lampiao', 32, 45); objeto(m, 'lampiao', 39, 45);
    objeto(m, 'barril', 40, 45);
    // Estrada do portão norte para os campos.
    preencher(m, 29, 2, 30, MY0 - 1, 1);

    // Campos a leste (vespas).
    [[56,10],[60,14],[64,9],[58,20],[63,24],[55,16],[66,18],[54,26],[68,12]]
      .forEach(([x, y]) => { if (T[y][x] === 0) T[y][x] = 3; });

    // Floresta de Elden, densa, no extremo leste.
    for (let y = 4; y < 40; y++) for (let x = 66; x < 78; x++)
      if (T[y][x] === 0 && (x + y * 3) % 4 !== 0 && rng() < 0.55) T[y][x] = 3;
    [[67,8],[70,14],[68,20],[73,11],[71,26],[74,7],[76,18],[69,32],[73,34]]
      .forEach(([x, y]) => { if (T[y][x] === 3) T[y][x] = 0; });
    T[9][75] = 4; // baú escondido no fundo de Elden

    // Cemitério a sudoeste.
    preencher(m, 8, 44, 24, 57, 0);
    [[10,46],[13,48],[17,46],[20,48],[11,51],[15,52],[19,51],[22,49],
     [9,54],[14,55],[18,55],[22,54],[12,45],[21,45]]
      .forEach(([x, y]) => { if (T[y][x] === 0) T[y][x] = 15; });
    T[52][8] = 4;
    // Capela do cemitério, com a entrada das catacumbas ao lado.
    predio(m, 14, 40, 6, 5, 'chapel', { porta: 3 });
    T[45][17] = 12; // portal para as catacumbas
    preencher(m, 16, 45, 18, 45, 1);
    preencher(m, 17, 46, 17, 50, 1);

    // Placas de orientação.
    T[39][31] = 16; T[54][26] = 16; T[43][28] = 16; T[20][54] = 16;

    m.boat = { x: 34, y: 55 };
    // Feito por último: a mata de Elden é sorteada e sempre deixa clareiras
    // muradas se ninguém abrir passagem.
    garantirConexao(m, 30, 25);
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

  // A grade de reserva era andaime da construção: não interessa a quem joga.
  for (const m of Object.values(MAPS)) delete m.res;
  return MAPS;
}
