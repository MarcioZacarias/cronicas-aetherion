// =========================================================
// Conteúdo do jogo: classes, itens, monstros e NPCs.
// Compartilhado — o servidor usa para simular, o cliente para desenhar
// e montar a UI. Os números aqui são a fonte da verdade dos dois lados.
// =========================================================

// ---------------------------------------------------------
// CLASSES
// Cada classe define curvas de atributo por nível e uma magia.
// A do Sacerdote cura aliados: é o que faz um grupo valer mais do que
// a soma dos jogadores sozinhos.
// ---------------------------------------------------------
export const CLASSES = {
  cavaleiro: {
    id: 'cavaleiro', name: 'Cavaleiro', icon: '🛡️', sprite: 'soldier_a',
    tagline: 'Segura a linha de frente.',
    desc: 'Muita vida e defesa, dano corpo a corpo consistente. Mana curta — é quem aguenta o dano enquanto o grupo trabalha.',
    hp: { base: 130, per: 24 }, mp: { base: 30, per: 5 },
    atk: { base: 6, per: 2.2 }, def: { base: 5, per: 1.5 },
    range: 1, atkCd: 1900,
    spell: {
      id: 'exori', name: 'Exori', cost: 20, cd: 4000, kind: 'aoe',
      radius: 1, power: { base: 18, per: 5 },
      desc: 'Golpe circular que atinge tudo ao seu redor.',
    },
    start: { weapon: 'sword1', armor: 'armor1', extra: [] },
  },
  mago: {
    id: 'mago', name: 'Mago', icon: '🔮', sprite: 'priest',
    tagline: 'Dano bruto, corpo frágil.',
    desc: 'O maior dano do jogo e o menor bolso de vida. Precisa de distância e de alguém segurando o inimigo.',
    hp: { base: 80, per: 12 }, mp: { base: 90, per: 18 },
    atk: { base: 3, per: 1.0 }, def: { base: 1, per: 0.6 },
    range: 1, atkCd: 2200,
    spell: {
      id: 'flam', name: 'Exori Flam', cost: 25, cd: 2600, kind: 'bolt',
      range: 5, power: { base: 30, per: 9 },
      desc: 'Projétil de fogo em um alvo à distância.',
    },
    start: { weapon: null, armor: null, extra: ['mpotion', 'mpotion'] },
  },
  arqueiro: {
    id: 'arqueiro', name: 'Arqueiro', icon: '🏹', sprite: 'villager_c',
    tagline: 'Ataca de longe, sem parar.',
    desc: 'Ataque básico à distância e a menor recarga do jogo. Vida média — sobrevive enquanto mantiver o espaço.',
    hp: { base: 100, per: 16 }, mp: { base: 50, per: 10 },
    atk: { base: 5, per: 1.8 }, def: { base: 2, per: 0.9 },
    range: 4, atkCd: 1400,
    spell: {
      id: 'con', name: 'Exori Con', cost: 18, cd: 3200, kind: 'bolt',
      range: 6, power: { base: 22, per: 6.5 },
      desc: 'Flecha perfurante de longo alcance.',
    },
    start: { weapon: 'sword1', armor: null, extra: ['potion'] },
  },
  sacerdote: {
    id: 'sacerdote', name: 'Sacerdote', icon: '✨', sprite: 'princess_a',
    tagline: 'Mantém o grupo de pé.',
    desc: 'Cura a si e a todos os aliados por perto. Sozinho é lento; num grupo, decide se ele volta vivo.',
    hp: { base: 95, per: 15 }, mp: { base: 80, per: 15 },
    atk: { base: 4, per: 1.3 }, def: { base: 3, per: 1.0 },
    range: 1, atkCd: 2000,
    spell: {
      id: 'exura', name: 'Exura Sio', cost: 30, cd: 5000, kind: 'heal',
      radius: 3, power: { base: 40, per: 11 },
      desc: 'Restaura vida sua e de aliados num raio de 3 tiles.',
    },
    start: { weapon: null, armor: 'armor1', extra: ['potion', 'mpotion'] },
  },
};

export const CLASS_IDS = Object.keys(CLASSES);

export function xpNeeded(level) { return 50 * level * level; }

// Atributos derivados: classe + nível. Equipamento entra por fora.
export function baseStats(classId, level) {
  const c = CLASSES[classId];
  const n = level - 1;
  return {
    hpMax: Math.round(c.hp.base + c.hp.per * n),
    mpMax: Math.round(c.mp.base + c.mp.per * n),
    atk: Math.round(c.atk.base + c.atk.per * n),
    def: Math.round(c.def.base + c.def.per * n),
  };
}

export function spellPower(classId, level) {
  const s = CLASSES[classId].spell;
  return Math.round(s.power.base + s.power.per * (level - 1));
}

// ---------------------------------------------------------
// ITENS
// ---------------------------------------------------------
export const ITEMS = {
  sword1:    { name: 'Espada de Recruta', icon: '🗡️', slot: 'weapon', atk: 3, price: 50 },
  sword2:    { name: 'Lâmina do Capataz', icon: '⚔️', slot: 'weapon', atk: 8 },
  sword3:    { name: 'Espada de Aço', icon: '⚔️', slot: 'weapon', atk: 12, price: 250 },
  shield1:   { name: 'Escudo de Madeira', icon: '🛡️', slot: 'shield', def: 2, price: 60 },
  shield2:   { name: 'Escudo de Ferro', icon: '🛡️', slot: 'shield', def: 4, price: 220 },
  armor1:    { name: 'Armadura de Couro', icon: '🥋', slot: 'armor', def: 3, price: 80 },
  armor2:    { name: 'Armadura de Malha', icon: '⛓️', slot: 'armor', def: 6, price: 300 },
  ring1:     { name: 'Anel do Mineiro', icon: '💍', slot: 'ring', atk: 1, def: 1 },
  medallion: { name: 'Medalhão do Eclipse', icon: '🌑', slot: 'ring', atk: 2, def: 2 },
  potion:    { name: 'Poção de Vida', icon: '🧪', use: 'heal', heal: 50, stack: true, price: 30 },
  bigpotion: { name: 'Poção Forte', icon: '❤️', use: 'heal', heal: 120, stack: true, price: 70 },
  mpotion:   { name: 'Poção de Mana', icon: '💙', use: 'mana', mana: 40, stack: true, price: 25 },
  torch:     { name: 'Tocha', icon: '🔦', passive: 'Ilumina cavernas e criptas', price: 15 },
  pickaxe:   { name: 'Picareta', icon: '⛏️', passive: 'Quebra paredes frágeis', price: 45 },
  fragment:  { name: 'Fragmento do Abismo', icon: '🟣', passive: 'Frio ao toque. Algo pulsa dentro dele.' },
};

export const EQ_SLOTS = ['weapon', 'shield', 'armor', 'ring'];

// ---------------------------------------------------------
// MONSTROS
// ---------------------------------------------------------
export const MSPR = {
  slime: { fw: 32, fh: 32 }, bee: { fw: 32, fh: 32 }, snake: { fw: 32, fh: 32 },
  bat: { fw: 32, fh: 32 }, sworm: { fw: 32, fh: 32 }, bworm: { fw: 35, fh: 50 },
  eyeball: { fw: 32, fh: 38 }, ghost: { fw: 40, fh: 46 }, pumpking: { fw: 46, fh: 46 },
  wasp: { fw: 32, fh: 32 }, flower: { fw: 60, fh: 76 },
  zombie: { fw: 64, fh: 64, people: true }, cultist: { fw: 64, fh: 64, people: true },
  priest: { fw: 64, fh: 64, people: true },
};

export const MTYPES = {
  slime:   { name: 'Slime da Floresta', hp: 40, dmg: [2, 6], xp: 25, gold: [3, 10], speed: 900, drops: [['potion', 0.25]] },
  bee:     { name: 'Abelha Gigante', hp: 35, dmg: [3, 7], xp: 30, gold: [3, 9], speed: 550, drops: [['mpotion', 0.2]] },
  snake:   { name: 'Cobra do Pântano', hp: 60, dmg: [4, 10], xp: 40, gold: [5, 15], speed: 750, drops: [['potion', 0.2], ['armor1', 0.06]] },
  bat:     { name: 'Morcego da Caverna', hp: 30, dmg: [1, 5], xp: 20, gold: [2, 8], speed: 550, drops: [['mpotion', 0.25]] },
  sworm:   { name: 'Verme Rastejante', hp: 55, dmg: [4, 9], xp: 45, gold: [4, 12], speed: 850, drops: [['potion', 0.25]] },
  bworm:   { name: 'Verme Colossal', hp: 140, dmg: [8, 15], xp: 110, gold: [10, 25], speed: 1100, drops: [['potion', 0.3], ['shield1', 0.1]] },
  eyeball: { name: 'Horror Menor', hp: 90, dmg: [7, 14], xp: 90, gold: [8, 20], speed: 700, drops: [['mpotion', 0.3]] },
  ghost:   { name: 'Espírito Corrompido', hp: 120, dmg: [9, 16], xp: 130, gold: [10, 26], speed: 800, drops: [['mpotion', 0.3], ['potion', 0.2]] },
  gormak:  { name: 'Gormak, o Corrompido', hp: 350, dmg: [8, 16], xp: 600, gold: [80, 120], speed: 1100, drops: [['sword2', 1]], sprite: 'pumpking', scale: 1.5, boss: true },
  wasp:    { name: 'Vespa de Guerra', hp: 90, dmg: [8, 14], xp: 70, gold: [8, 18], speed: 500, drops: [['mpotion', 0.25]] },
  flower:  { name: 'Flor Carnívora de Elden', hp: 180, dmg: [12, 20], xp: 160, gold: [0, 0], speed: 900, static: true, drops: [['bigpotion', 0.35], ['potion', 0.3]] },
  zombie:  { name: 'Morto Errante', hp: 150, dmg: [10, 18], xp: 140, gold: [10, 24], speed: 1150, drops: [['potion', 0.3]] },
  spectre: { name: 'Espectro do Cemitério', hp: 200, dmg: [14, 22], xp: 200, gold: [14, 30], speed: 800, sprite: 'ghost', scale: 1.15, drops: [['mpotion', 0.35], ['bigpotion', 0.15]] },
  cultist: { name: 'Cultista da Irmandade', hp: 180, dmg: [13, 22], xp: 210, gold: [16, 34], speed: 750, drops: [['bigpotion', 0.2], ['mpotion', 0.2]] },
  corvus:  { name: 'Alto Sacerdote Corvus', hp: 900, dmg: [16, 28], xp: 2000, gold: [300, 400], speed: 1000, drops: [['medallion', 1]], sprite: 'priest', scale: 1.2, boss: true },
};

// Tabela de nascimento: [tipo, mapa, x, y]
export const SPAWNS = [
  // Ilha de Aurora — arredores de Lumera
  ['slime', 'over', 7, 6], ['slime', 'over', 10, 9], ['slime', 'over', 5, 7], ['slime', 'over', 10, 6],
  ['bee', 'over', 24, 8], ['bee', 'over', 31, 13], ['bee', 'over', 27, 17],
  // A cobra do pântano nascia em (30,23), que o gerador transforma em água:
  // ela ficava presa, sem poder se mover nem ser alcançada.
  ['snake', 'over', 31, 22], ['snake', 'over', 33, 26], ['snake', 'over', 28, 25],
  ['bat', 'over', 14, 4], ['bat', 'over', 22, 5],

  // Minas de Aurora
  ['sworm', 'mine', 8, 14], ['sworm', 'mine', 17, 13], ['sworm', 'mine', 24, 14], ['sworm', 'mine', 13, 20],
  ['bat', 'mine', 6, 13], ['bat', 'mine', 20, 13], ['bat', 'mine', 16, 21],
  ['bworm', 'mine', 21, 10], ['bworm', 'mine', 25, 5],
  ['eyeball', 'mine', 18, 4], ['eyeball', 'mine', 22, 7], ['eyeball', 'mine', 26, 4],
  ['ghost', 'mine', 14, 6], ['ghost', 'mine', 17, 7],
  ['gormak', 'mine', 7, 6],

  // Valedorn — campos a leste das muralhas
  ['wasp', 'vale', 57, 12], ['wasp', 'vale', 61, 16], ['wasp', 'vale', 65, 11],
  ['wasp', 'vale', 59, 22], ['wasp', 'vale', 62, 26], ['wasp', 'vale', 56, 30],
  // Floresta de Elden (as clareiras abertas no gerador)
  ['flower', 'vale', 67, 8], ['flower', 'vale', 70, 14], ['flower', 'vale', 68, 20],
  ['flower', 'vale', 73, 11], ['flower', 'vale', 71, 26], ['flower', 'vale', 69, 32],
  // Cemitério, a sudoeste
  ['zombie', 'vale', 11, 47], ['zombie', 'vale', 16, 50], ['zombie', 'vale', 20, 53],
  ['zombie', 'vale', 12, 56], ['zombie', 'vale', 22, 46],
  ['spectre', 'vale', 14, 49], ['spectre', 'vale', 19, 56], ['spectre', 'vale', 9, 50],

  // Floresta Profunda
  ['slime', 'floresta', 12, 24], ['slime', 'floresta', 15, 30], ['slime', 'floresta', 25, 28],
  ['snake', 'floresta', 10, 36], ['snake', 'floresta', 30, 30],
  ['bee', 'floresta', 18, 22], ['bee', 'floresta', 35, 28],
  ['flower', 'floresta', 38, 32], ['flower', 'floresta', 6, 28],

  // Catacumbas
  ['cultist', 'cata', 10, 9], ['cultist', 'cata', 18, 10], ['cultist', 'cata', 20, 9], ['cultist', 'cata', 23, 8], ['cultist', 'cata', 25, 10],
  ['spectre', 'cata', 5, 7], ['spectre', 'cata', 8, 9], ['spectre', 'cata', 6, 10],
  ['zombie', 'cata', 15, 14], ['zombie', 'cata', 13, 18],
  ['corvus', 'cata', 14, 4],
];

// ---------------------------------------------------------
// NPCS
// ---------------------------------------------------------
export const NPCS = [
  // --- Vila de Lumera: cada um na porta do seu estabelecimento ---
  { id: 'toren', name: 'Toren — Ferreiro', img: 'villager_a', map: 'over', x: 8, y: 18 },
  { id: 'mira', name: 'Mira — Alquimista', img: 'princess_a', map: 'over', x: 20, y: 18 },
  { id: 'irina', name: 'Irina — Sacerdotisa', img: 'princess_c', map: 'over', x: 7, y: 28 },
  { id: 'bento', name: 'Bento — Cocheiro', img: 'villager_b', map: 'over', x: 20, y: 29 },
  { id: 'cedric', name: 'Cedric — Capitão da Guarda', img: 'guard_a', map: 'over', x: 13, y: 18 },

  // --- Ardentia: o eixo comercial de frente para a praça ---
  { id: 'gorm', name: 'Gorm — Caixa do Banco', img: 'villager_a', map: 'vale', x: 23, y: 20 },
  { id: 'elara', name: 'Elara — Bibliotecária', img: 'princess_c', map: 'vale', x: 35, y: 20 },
  { id: 'harlan', name: 'Mestre Harlan — Armeiro', img: 'guard_b', map: 'vale', x: 41, y: 20 },
  { id: 'sela', name: 'Sela — Boticária', img: 'princess_b', map: 'vale', x: 47, y: 20 },
  { id: 'edmun', name: 'Escrivão Edmun — Prefeitura', img: 'villager_c', map: 'vale', x: 15, y: 37 },
  { id: 'brida', name: 'Brida — Taverneira', img: 'princess', map: 'vale', x: 23, y: 37 },
  { id: 'seraf', name: 'Serafina — Sacerdotisa do Templo', img: 'princess_a', map: 'vale', x: 11, y: 13 },
  { id: 'jorun', name: 'Jorun — Mestre das Carruagens', img: 'guard_b', map: 'vale', x: 32, y: 37 },
  { id: 'lyra', name: 'Capitã Lyra — Guarda de Ardentia', img: 'guard_a', map: 'vale', x: 30, y: 37 },
  { id: 'tomas', name: 'Irmão Tomas — Irmandade', img: 'villager_b', map: 'vale', x: 28, y: 21 },
  { id: 'aldous', name: 'Velho Aldous — Mendigo', img: 'villager_c', map: 'vale', x: 28, y: 27 },
  { id: 'nilo', name: 'Nilo — Garoto Curioso', img: 'villager_b', map: 'vale', x: 33, y: 25 },
  { id: 'rosa', name: 'Rosa — Estalajadeira', img: 'princess', map: 'vale', x: 32, y: 46 },

  // --- Castelo de Aurora ---
  { id: 'ricard', name: 'Ricard — Guarda Real', img: 'guard_a', map: 'castelo', x: 23, y: 28 },
  { id: 'rei', name: 'Rei Aldric de Aurora', img: 'guard_b', map: 'trono', x: 19, y: 16 },
];

// ---------------------------------------------------------
// SERVIÇOS DA CIDADE
// ---------------------------------------------------------

// Quem atende o balcão do banco. O acervo é da CONTA, não do personagem:
// assim dá para passar ouro e equipamento entre os seus próprios heróis.
export const BANCARIOS = ['gorm'];

// Templos: onde se renasce. Ficam na porta do prédio, não dentro dele.
export const TEMPLOS = {
  lumera:   { nome: 'Santuário de Lumera',  map: 'over', x: 9,  y: 28 },
  ardentia: { nome: 'Templo de Ardentia',   map: 'vale', x: 14, y: 13 },
};

// Viagem paga. O preço é o que separa "atalho conveniente" de "teleporte
// que torna o mundo irrelevante" — andar continua sendo de graça.
export const DESTINOS = {
  lumera:    { nome: 'Lumera',                map: 'over', x: 21, y: 29, preco: 60 },
  castelo:   { nome: 'Castelo de Aurora',     map: 'castelo', x: 20, y: 28, preco: 40 },
  minas:     { nome: 'Entrada das Minas',     map: 'over', x: 14, y: 7,  preco: 35 },
  ardentia:  { nome: 'Ardentia',              map: 'vale', x: 31, y: 37, preco: 60 },
  cemiterio: { nome: 'Cemitério de Ardentia', map: 'vale', x: 17, y: 47, preco: 40 },
};

// Cada cocheiro oferece as rotas que fazem sentido de onde ele está.
export const ESTACOES = {
  bento: ['ardentia', 'minas', 'castelo'],
  jorun: ['lumera', 'cemiterio'],
};

// Lojas: quem vende o quê. Armaria e botica são especializadas — quem
// quer poção não procura no ferreiro.
export const SHOPS = {
  toren:  ['sword1', 'shield1', 'armor1', 'pickaxe'],
  mira:   ['potion', 'mpotion', 'torch'],
  harlan: ['sword1', 'sword3', 'shield1', 'shield2', 'armor1', 'armor2'],
  sela:   ['potion', 'bigpotion', 'mpotion', 'torch', 'pickaxe'],
};

// Quem morre acorda no templo da região. Se o personagem já registrou um
// templo (tocando o altar), o servidor prefere esse.
export const RESPAWN_POINTS = {
  over: TEMPLOS.lumera,
  mine: TEMPLOS.lumera,
  vale: TEMPLOS.ardentia,
  cata: TEMPLOS.ardentia,
};

// Portais PONTUAIS: chave "mapa:x,y" -> destino. Diferente dos PORTALS
// por tile (12/11), estes disparam pela posição exata — necessário porque
// o over já usa o tile 12 para a mina e não dá para ter dois "enter".
export const PORTAIS = {
  // estrada do castelo (norte do over) <-> gramado diante do portão
  'over:30,3': { map: 'castelo', x: 19, y: 28 },
  'over:31,3': { map: 'castelo', x: 20, y: 28 },
  'castelo:18,29': { map: 'over', x: 30, y: 4 },
  'castelo:19,29': { map: 'over', x: 30, y: 4 },
  'castelo:20,29': { map: 'over', x: 31, y: 4 },
  'castelo:21,29': { map: 'over', x: 31, y: 4 },
  // portão do castelo <-> sala do trono
  'castelo:19,24': { map: 'trono', x: 19, y: 22 },
  'castelo:20,24': { map: 'trono', x: 20, y: 22 },
  'trono:19,24': { map: 'castelo', x: 19, y: 25 },
  'trono:20,24': { map: 'castelo', x: 20, y: 25 },
  // trilha oeste do over <-> trilha sul da floresta
  'over:2,12': { map: 'floresta', x: 24, y: 47 },
  'over:2,13': { map: 'floresta', x: 25, y: 47 },
  'floresta:24,49': { map: 'over', x: 3, y: 12 },
  'floresta:25,49': { map: 'over', x: 3, y: 13 },
};

// Ligações entre mapas: tile 12 entra, tile 11 sai.
export const PORTALS = {
  over: { enter: { map: 'mine', x: 15, y: 21 } },
  mine: { exit: { map: 'over', x: 18, y: 6 } },
  // A entrada das catacumbas fica na capela do cemitério, fora das muralhas.
  vale: { enter: { map: 'cata', x: 14, y: 18 } },
  cata: { exit: { map: 'vale', x: 17, y: 46 } },
};
