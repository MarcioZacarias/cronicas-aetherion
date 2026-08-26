#!/usr/bin/env python3
"""
Importa conjuntos de tiles dos pacotes LPC para atlas enxutos do jogo.

Os pacotes trazem folhas gigantes (roofs.png tem 4096 tiles; bricks.png,
2048) das quais usamos um punhado de conjuntos. Servir isso inteiro para o
navegador seria desperdício, e caçar coordenada na mão é como se erra.

Os .tsx do Tiled que acompanham as folhas descrevem cada conjunto como
"terrain" — Wang tiles por CANTO. O atributo é `terrain="tl,tr,bl,br"`,
dizendo quais cantos do tile pertencem ao terreno. Disso dá para deduzir
os nove pedaços de que precisamos para preencher um retângulo:

    nw  n  ne
    w  meio  e
    sw  s  se

Este script lê o .tsx, recorta os nove e empacota tudo numa fita de 9
tiles por conjunto, com um índice JSON.

Uso:  python tools/importar-lpc.py [pasta_dos_pacotes]
"""

import json
import re
import sys
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ASSETS = RAIZ / 'public' / 'assets'
T = 32

# Ordem fixa da fita de saída.
FATIAS = ['nw', 'n', 'ne', 'w', 'meio', 'e', 'sw', 's', 'se']

# Assinatura de cantos de cada fatia. '' = fora do terreno, 'X' = dentro.
# Ex.: o canto superior-esquerdo do bloco só tem terreno no canto BR.
ASSINATURA = {
    'nw':   ('', '', '', 'X'),
    'n':    ('', '', 'X', 'X'),
    'ne':   ('', '', 'X', ''),
    'w':    ('', 'X', '', 'X'),
    'meio': ('X', 'X', 'X', 'X'),
    'e':    ('X', '', 'X', ''),
    'sw':   ('', 'X', '', ''),
    's':    ('X', 'X', '', ''),
    'se':   ('X', '', '', ''),
}

# O que trazer de cada pacote: (arquivo .tsx, prefixo de saída, conjuntos).
#
# ATENÇÃO aos nomes: no roofs.tsx os conjuntos "Flat" estão ROTULADOS
# ERRADO pelo autor do pacote — Roof_Flat_Red é azul, Roof_Flat_Green é
# vermelho, Roof_Flat_Blue é marrom (conferido medindo o pixel). Por isso
# a chave que o jogo usa vem da cor MEDIDA, não do rótulo; o nome original
# fica guardado no índice só para rastrear a origem.
PLANO = [
    ('lpc-victorian-preview-see-readme/roofs.tsx', 'telhado', [
        'Roof_Flat_Red', 'Roof_Flat_Slate', 'Roof_Flat_Green', 'Roof_Flat_Blue',
        'Roof_Flat_Brown', 'Roof_Flat_Purple', 'Roof_Flat_Grey', 'Roof_Flat_Slate_Light',
        'Roof_Zelda_Red', 'Roof_Zelda_Blue', 'Roof_Zelda_Green', 'Roof_Zelda_Brown',
    ]),
    ('lpc-victorian-preview-see-readme/bricks.tsx', 'piso', [
        'Cobble_1_Grey', 'Cobble_1_Tan', 'Cobble_1_Brown', 'Cobble_1_Slate',
        'Cobble_2_Grey', 'Pavers_Grey', 'Pavers_White',
    ]),
    ('lpc-victorian-preview-see-readme/bricks.tsx', 'parede', [
        'Square_Brick_Tan', 'Square_Brick_Red', 'Square_Brick_Grey',
        'Square_Brick_White', 'Square_Brick_Slate', 'Square_Brick_Brown',
    ]),
]

# ---------------------------------------------------------
# Terreno: transições entre PARES
#
# terrain-map-v8.tsx não descreve "terreno contra vazio" como roofs e
# bricks: ali TODO tile é uma mistura de dois terrenos, canto a canto
# ("5,5,0,0" = grama em cima, terra embaixo). Ou seja, a transição é
# específica do par, e é justamente isso que faz grama e terra deixarem
# de se encostar em linha reta.
#
# (nome no jogo, terreno de cima, terreno de baixo)
# ---------------------------------------------------------
TERRENO_TSX = 'lpc-victorian-preview-see-readme/terrain-map-v8.tsx'
PARES_TERRENO = [
    ('grama_terra', 'Grass', 'Dirt_Brown'),
    ('grama_areia', 'Grass', 'Sand'),
    ('areia_agua', 'Sand', 'Water'),
    ('terra_areia', 'Dirt_Brown', 'Sand'),
    ('grama_pedra', 'Grass', 'Gravel_1'),
]

# Assinatura de cantos de cada fatia, para o par (A sobre B).
# A ordem do Tiled é tl,tr,bl,br.
ASSINATURA_PAR = {
    'meio': ('A', 'A', 'A', 'A'),
    'n':    ('B', 'B', 'A', 'A'),
    's':    ('A', 'A', 'B', 'B'),
    'w':    ('B', 'A', 'B', 'A'),
    'e':    ('A', 'B', 'A', 'B'),
    'nw':   ('B', 'B', 'B', 'A'),
    'ne':   ('B', 'B', 'A', 'B'),
    'sw':   ('B', 'A', 'B', 'B'),
    'se':   ('A', 'B', 'B', 'B'),
}


def importar_terrenos(base):
    caminho = base / TERRENO_TSX
    if not caminho.exists():
        return [], ['terreno: terrain-map-v8.tsx ausente']
    colunas, fonte, terrenos, cantos = ler_tsx(caminho)
    porNome = {n: i for i, (n, _) in enumerate(terrenos)}
    folha = Image.open(caminho.parent / fonte).convert('RGBA')
    saida, faltando = [], []
    for chave, nomeA, nomeB in PARES_TERRENO:
        if nomeA not in porNome or nomeB not in porNome:
            faltando.append(f'terreno/{chave} (terreno inexistente)')
            continue
        a, b = str(porNome[nomeA]), str(porNome[nomeB])
        achados = {}
        for tid, quatro in cantos.items():
            marcado = tuple('A' if c == a else ('B' if c == b else '?') for c in quatro)
            if '?' in marcado:
                continue
            for fatia, assinatura in ASSINATURA_PAR.items():
                if marcado == assinatura and fatia not in achados:
                    achados[fatia] = tid
        if len(achados) < 9:
            faltando.append(f'terreno/{chave} (só {len(achados)}/9 fatias)')
            continue
        saida.append((chave, folha, colunas, achados))
    return saida, faltando

# Referências para batizar um conjunto pela cor que ele REALMENTE tem.
# Precisa cobrir os tons ESCUROS separadamente: sem eles, marrom-escuro,
# vinho e verde-musgo caem todos em "preto" e viram preto2, preto3...
PALETA = [
    ('vermelho', (150, 45, 30)), ('vinho', (95, 42, 42)),
    ('azul', (45, 80, 170)), ('verde', (30, 95, 60)), ('musgo', (55, 75, 60)),
    ('marrom', (130, 85, 50)), ('sepia', (92, 62, 40)),
    ('roxo', (85, 70, 105)), ('cinza', (120, 125, 128)), ('ardosia', (78, 84, 94)),
    ('grafite', (52, 54, 62)), ('creme', (205, 195, 170)), ('palha', (190, 165, 120)),
    ('branco', (228, 228, 224)),
]


def nomear_por_cor(img):
    """Batiza pela cor média dos pixels opacos — os rótulos do pacote mentem."""
    import numpy as np
    a = np.array(img)
    op = a[:, :, 3] > 128
    if op.sum() == 0:
        return 'vazio'
    c = a[:, :, :3][op].mean(axis=0)
    melhor, dist = None, 1e9
    for nome, ref in PALETA:
        d = sum((float(c[i]) - ref[i]) ** 2 for i in range(3))
        if d < dist:
            melhor, dist = nome, d
    return melhor


def ler_tsx(caminho):
    texto = caminho.read_text(encoding='utf-8')
    cab = re.search(r'<tileset[^>]*columns="(\d+)"', texto)
    colunas = int(cab.group(1))
    fonte = re.search(r'<image source="([^"]+)"', texto).group(1)
    terrenos = [(n, int(t)) for n, t in
                re.findall(r'<terrain name="([^"]+)" tile="(\d+)"', texto)]
    cantos = {}
    for tid, valor in re.findall(r'<tile id="(\d+)" terrain="([^"]*)"', texto):
        partes = valor.split(',')
        if len(partes) == 4:
            cantos[int(tid)] = tuple(partes)
    return colunas, fonte, terrenos, cantos


def fatias_do_terreno(indice, cantos):
    """Encontra o tile de cada uma das nove fatias para um terreno."""
    alvo = str(indice)
    achados = {}
    for tid, quatro in cantos.items():
        # Um tile só serve se TODOS os cantos preenchidos forem deste
        # terreno — senão é uma transição entre dois terrenos diferentes.
        marcado = tuple('X' if c == alvo else ('' if c == '' else '?') for c in quatro)
        if '?' in marcado:
            continue
        for nome, assinatura in ASSINATURA.items():
            if marcado == assinatura and nome not in achados:
                achados[nome] = tid
    return achados


# ---------------------------------------------------------
# Telhados COMPLETOS
#
# Os telhados inclinados do LPC não são costuráveis: as bordas são
# tacaniças diagonais desenhadas para um canto específico, e repeti-las
# produz uma serra. São kits de montagem manual.
#
# A saída é usar peças inteiras. Em roofs.png, a linha y=0 tem dez
# telhados completos de 5x4 — cumeeira, quatro águas e beirais —, um a
# cada 5 colunas. Cada prédio do jogo passa a ser um múltiplo desse
# módulo de 5, que é como uma fileira de sobrados realmente se parece.
# ---------------------------------------------------------
TELHADOS_FONTE = 'lpc-victorian-preview-see-readme/roofs.png'
TELHADO_W, TELHADO_H, TELHADO_Y = 5, 4, 0
TELHADO_XS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45]


def importar_telhados(base, atlas_saida):
    caminho = base / TELHADOS_FONTE
    if not caminho.exists():
        return []
    folha = Image.open(caminho).convert('RGBA')
    saida = []
    for x in TELHADO_XS:
        rec = folha.crop((x * T, TELHADO_Y * T,
                          (x + TELHADO_W) * T, (TELHADO_Y + TELHADO_H) * T))
        saida.append((nomear_por_cor(rec), rec, x))
    return saida


# ---------------------------------------------------------
# Mobiliário urbano
#
# Substitui os props que eu desenhava com retângulos de canvas. Cada
# entrada é (nome, folha, x, y, largura, altura) em tiles.
# ---------------------------------------------------------
PROPS = [
    # mercado — a barraca com balcão e mercadoria, não só a lona
    ('banca',     'lpc-victorian-decoration/victorian-market.png',   0,  4, 3, 4),
    ('banca2',    'lpc-victorian-decoration/victorian-market.png',   0, 22, 4, 3),
    ('banco',     'lpc-victorian-decoration/victorian-market.png',   0, 14, 2, 1),
    ('banco2',    'lpc-victorian-decoration/victorian-market.png',   4, 14, 2, 1),
    ('carroca',   'lpc-victorian-decoration/victorian-market.png',   4, 10, 3, 2),
    ('lixeira',   'lpc-victorian-decoration/victorian-market.png',   4,  8, 1, 1),
    # jardim
    ('fonte',     'lpc-victorian-decoration/victorian-garden.png',   6,  4, 2, 2),
    ('arvorinha', 'lpc-victorian-decoration/victorian-garden.png',   2, 10, 1, 2),
    ('arbusto',   'lpc-victorian-decoration/victorian-garden.png',   4, 16, 1, 1),
    ('canteiro',  'lpc-victorian-decoration/victorian-garden.png',   8, 22, 2, 1),
    ('canteiro2', 'lpc-victorian-decoration/victorian-garden.png',  10, 22, 2, 1),
    ('urna',      'lpc-victorian-decoration/victorian-garden.png',   0,  8, 1, 1),
    # do pacote base
    ('barril',    'lpc_base_assets/tiles__barrel.png',               0,  0, 1, 1),
    ('engradado', 'lpc_base_assets/tiles__chests.png',               0,  0, 1, 1),
    ('poco',      'lpc_base_assets/tiles__buckets.png',              0,  0, 1, 1),
]


# Poste e luminária ficam em REGIÕES DIFERENTES da folha: um recorte
# contíguo de 1x2 pega duas cabeças, não um poste completo. Estes são
# montados empilhando dois tiles distintos.
PROPS_COMPOSTOS = [
    # (nome, folha, [(x,y) de baixo para cima])
    ('lampiao',  'lpc-victorian-decoration/victorian-streets.png', [(0, 7), (0, 16)]),
    ('lampiao2', 'lpc-victorian-decoration/victorian-streets.png', [(2, 7), (2, 16)]),
]


def importar_compostos(base):
    itens, faltando = [], []
    for nome, rel, pilha in PROPS_COMPOSTOS:
        caminho = base / rel
        if not caminho.exists():
            faltando.append(f'prop/{nome} ({rel} ausente)')
            continue
        folha = Image.open(caminho).convert('RGBA')
        alt = len(pilha)
        im = Image.new('RGBA', (T, alt * T), (0, 0, 0, 0))
        # A lista vem de baixo para cima; desenhamos de cima para baixo.
        for i, (x, y) in enumerate(reversed(pilha)):
            im.alpha_composite(folha.crop((x * T, y * T, (x + 1) * T, (y + 1) * T)), (0, i * T))
        itens.append((nome, im, 1, alt))
    return itens, faltando


def importar_props(base):
    itens, faltando = [], []
    for nome, rel, x, y, w, h in PROPS:
        caminho = base / rel
        if not caminho.exists():
            faltando.append(f'prop/{nome} ({rel} ausente)')
            continue
        folha = Image.open(caminho).convert('RGBA')
        if (x + w) * T > folha.width or (y + h) * T > folha.height:
            faltando.append(f'prop/{nome} (recorte fora da folha)')
            continue
        rec = folha.crop((x * T, y * T, (x + w) * T, (y + h) * T))
        import numpy as np
        if (np.array(rec)[:, :, 3] > 40).mean() < 0.05:
            faltando.append(f'prop/{nome} (recorte vazio)')
            continue
        itens.append((nome, rec, w, h))
    return itens, faltando


def main():
    base = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('assets-lpc')
    if not base.exists():
        print(f'pasta {base} não existe — rode tools/catalogar-lpc.py antes')
        return

    conjuntos, faltando = [], []
    for rel_tsx, prefixo, nomes in PLANO:
        caminho = base / rel_tsx
        if not caminho.exists():
            print(f'  (ausente) {rel_tsx}')
            continue
        colunas, fonte, terrenos, cantos = ler_tsx(caminho)
        folha = Image.open(caminho.parent / fonte).convert('RGBA')
        porNome = {n: i for i, (n, _) in enumerate(terrenos)}
        for nome in nomes:
            if nome not in porNome:
                faltando.append(f'{prefixo}/{nome}')
                continue
            achados = fatias_do_terreno(porNome[nome], cantos)
            if len(achados) < 9:
                faltando.append(f'{prefixo}/{nome} (só {len(achados)}/9 fatias)')
                continue
            conjuntos.append((prefixo, nome, folha, colunas, achados))

    # Terreno entra na mesma fita, com o prefixo "terreno:".
    terrenos_pares, faltas_terreno = importar_terrenos(base)
    faltando.extend(faltas_terreno)
    for chave, folha, colunas, achados in terrenos_pares:
        conjuntos.append(('terreno', chave, folha, colunas, achados))

    if not conjuntos:
        print('nada importado')
        return

    atlas = Image.new('RGBA', (9 * T, len(conjuntos) * T), (0, 0, 0, 0))
    indice = {}
    usados = set()
    relato = []
    for linha, (prefixo, nome, folha, colunas, achados) in enumerate(conjuntos):
        recortes = {}
        for col, fatia in enumerate(FATIAS):
            tid = achados[fatia]
            sx, sy = (tid % colunas) * T, (tid // colunas) * T
            pedaco = folha.crop((sx, sy, sx + T, sy + T))
            recortes[fatia] = pedaco
            atlas.paste(pedaco, (col * T, linha * T))

        # Terreno já chega com nome descritivo do par; só telhado, piso e
        # parede precisam ser batizados pela cor medida.
        cor = nome if prefixo == 'terreno' else nomear_por_cor(recortes['meio'])
        chave = f'{prefixo}:{cor}'
        # Duas folhas podem cair na mesma cor; numera para não colidir.
        n = 2
        while chave in usados:
            chave = f'{prefixo}:{cor}{n}'
            n += 1
        usados.add(chave)

        indice[chave] = {
            'origem': nome,
            'fatias': {f: [i * T, linha * T, T, T] for i, f in enumerate(FATIAS)},
        }
        relato.append((prefixo, chave, nome))

    destino = ASSETS / 'lpc-sets.png'
    atlas.save(destino)

    # ---- telhados completos, em folha própria ----
    telhados = importar_telhados(base, None)
    tel_indice = {}
    if telhados:
        tel = Image.new('RGBA', (len(telhados) * TELHADO_W * T, TELHADO_H * T), (0, 0, 0, 0))
        usadas = set()
        for i, (cor, rec, xorig) in enumerate(telhados):
            chave = cor
            n = 2
            while chave in usadas:
                chave = f'{cor}{n}'; n += 1
            usadas.add(chave)
            tel.paste(rec, (i * TELHADO_W * T, 0))
            tel_indice[chave] = {'x': i * TELHADO_W * T, 'y': 0,
                                 'w': TELHADO_W * T, 'h': TELHADO_H * T,
                                 'origem': f'roofs.png ({xorig},{TELHADO_Y})'}
        tel.save(ASSETS / 'lpc-telhados.png')
        (ASSETS / 'lpc-telhados.json').write_text(
            json.dumps({'tile': T, 'modulo': [TELHADO_W, TELHADO_H],
                        'telhados': tel_indice}, indent=2), encoding='utf-8')
        print(f'lpc-telhados.png  {tel.width}x{tel.height}  '
              f'{len(tel_indice)} telhados de {TELHADO_W}x{TELHADO_H}: '
              f'{", ".join(tel_indice)}')

    # ---- mobiliário urbano ----
    props, faltas_props = importar_props(base)
    compostos, faltas_comp = importar_compostos(base)
    props = compostos + props
    faltando.extend(faltas_props + faltas_comp)
    if props:
        # Empacota lado a lado numa fita, alinhada ao tile.
        largura = sum(w for _, _, w, _ in props)
        altura = max(h for _, _, _, h in props)
        folha = Image.new('RGBA', (largura * T, altura * T), (0, 0, 0, 0))
        pIndice, ox = {}, 0
        for nome, rec, w, h in props:
            folha.paste(rec, (ox * T, 0))
            pIndice[nome] = {'x': ox * T, 'y': 0, 'w': w * T, 'h': h * T, 'tiles': [w, h]}
            ox += w
        folha.save(ASSETS / 'lpc-props.png')
        (ASSETS / 'lpc-props.json').write_text(
            json.dumps({'tile': T, 'props': pIndice}, indent=2), encoding='utf-8')
        print(f'lpc-props.png  {folha.width}x{folha.height}  {len(pIndice)} props: '
              f'{", ".join(pIndice)}')

    (ASSETS / 'lpc-sets.json').write_text(
        json.dumps({'tile': T, 'ordem': FATIAS, 'conjuntos': indice}, indent=2),
        encoding='utf-8')

    print(f'{destino.relative_to(RAIZ)}  {atlas.width}x{atlas.height}')
    print(f'{len(conjuntos)} conjuntos de 9 fatias (chave do jogo <- rótulo do pacote):')
    for prefixo in dict.fromkeys(p for p, *_ in relato):
        for p, chave, origem in relato:
            if p != prefixo:
                continue
            traducao = {
                'red': 'vermelho', 'blue': 'azul', 'green': 'verde', 'brown': 'marrom',
                'purple': 'roxo', 'grey': 'cinza', 'gray': 'cinza', 'slate': 'ardosia',
                'tan': 'palha', 'white': 'branco', 'light': 'claro', 'brick': 'tijolo',
            }
            rotulo = traducao.get(origem.split('_')[-1].lower())
            medida = re.sub(r'\d+$', '', chave.split(':')[1])
            # Só acusa divergência quando dá para comparar de fato.
            aviso = ('  <-- rótulo do pacote diz "%s"' % rotulo) if (
                rotulo and rotulo not in ('claro', 'tijolo') and rotulo != medida
                and not (rotulo == 'ardosia' and medida == 'cinza')) else ''
            print(f'  {chave:<22} <- {origem}{aviso}')
    if faltando:
        print('\nnão importados:')
        for f in faltando:
            print('  -', f)


if __name__ == '__main__':
    main()
