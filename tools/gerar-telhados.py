#!/usr/bin/env python3
"""
Gera public/assets/roof.png — telhas vistas DE CIMA.

Por que precisou existir: o pacote LPC deste projeto não tem uma única
telha. As fachadas são vistas de FRENTE (elevação), enquanto o Tibia
desenha tudo como superfície vista de cima. É essa diferença de ângulo —
não a quantidade de sprites — que fazia nossos prédios parecerem muros.

Telha é padrão repetitivo, então dá para sintetizar: fiadas de escamas
sobrepostas, cada uma com luz no topo e sombra na barra. O resultado é
costurável (tileable) porque a fiada tem 8px e o tile tem 32.

Uso:  python tools/gerar-telhados.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
ASSETS = RAIZ / 'public' / 'assets'
T = 32
LARG_TELHA = 8    # largura de uma escama
ALT_FIADA = 8     # altura de uma fiada

# (nome, cor base, luz, sombra, barra escura)
CORES = [
    ('turquesa', (86, 158, 148), (128, 196, 184), (52, 112, 106), (34, 78, 74)),
    ('telha',    (168, 84, 56),  (208, 124, 92),  (118, 54, 36),  (82, 36, 24)),
    ('ardosia',  (96, 100, 116), (134, 138, 154), (66, 70, 84),   (44, 47, 58)),
    ('madeira',  (140, 104, 60), (178, 140, 90),  (100, 72, 40),  (70, 50, 28)),
]

# Ordem das peças em cada linha do atlas.
PECAS = ['campo', 'cume', 'beira_baixo', 'beira_esq', 'beira_dir', 'canto_esq', 'canto_dir']


def escama(dr, x, y, base, luz, sombra, barra):
    """Uma telha: corpo, brilho no topo, sombra e barra embaixo."""
    dr.rectangle([x, y, x + LARG_TELHA - 1, y + ALT_FIADA - 1], fill=base)
    dr.rectangle([x + 1, y, x + LARG_TELHA - 2, y + 1], fill=luz)
    dr.rectangle([x, y + ALT_FIADA - 2, x + LARG_TELHA - 1, y + ALT_FIADA - 1], fill=barra)
    dr.rectangle([x + LARG_TELHA - 1, y, x + LARG_TELHA - 1, y + ALT_FIADA - 1], fill=sombra)


def campo(base, luz, sombra, barra):
    im = Image.new('RGBA', (T, T), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    for fi, y in enumerate(range(0, T, ALT_FIADA)):
        # Fiadas alternadas deslocam meia telha, como num telhado real.
        desl = 0 if fi % 2 == 0 else LARG_TELHA // 2
        for x in range(-LARG_TELHA, T + LARG_TELHA, LARG_TELHA):
            escama(dr, x + desl, y, base, luz, sombra, barra)
    return im


def cume(cores):
    base, luz, sombra, barra = cores
    im = campo(*cores)
    dr = ImageDraw.Draw(im)
    # Cumeeira: peça mais clara correndo na horizontal, no alto do tile.
    dr.rectangle([0, 0, T - 1, 5], fill=sombra)
    dr.rectangle([0, 1, T - 1, 3], fill=luz)
    for x in range(0, T, 6):
        dr.rectangle([x, 0, x, 5], fill=barra)
    return im


def beira_baixo(cores):
    base, luz, sombra, barra = cores
    im = campo(*cores)
    dr = ImageDraw.Draw(im)
    # Beiral: sombra projetada e a borda saliente da última fiada.
    dr.rectangle([0, T - 6, T - 1, T - 4], fill=barra)
    dr.rectangle([0, T - 3, T - 1, T - 1], fill=(0, 0, 0, 90))
    return im


def beira_lado(cores, esquerda):
    base, luz, sombra, barra = cores
    im = campo(*cores)
    dr = ImageDraw.Draw(im)
    x0 = 0 if esquerda else T - 4
    dr.rectangle([x0, 0, x0 + 3, T - 1], fill=barra)
    dr.rectangle([x0 + (1 if esquerda else 0), 0, x0 + (2 if esquerda else 1), T - 1], fill=sombra)
    return im


def canto(cores, esquerda):
    im = beira_lado(cores, esquerda)
    dr = ImageDraw.Draw(im)
    base, luz, sombra, barra = cores
    dr.rectangle([0, T - 6, T - 1, T - 4], fill=barra)
    dr.rectangle([0, T - 3, T - 1, T - 1], fill=(0, 0, 0, 90))
    return im


def main():
    atlas = Image.new('RGBA', (len(PECAS) * T, len(CORES) * T), (0, 0, 0, 0))
    indice = {}
    for li, (nome, *cores) in enumerate(CORES):
        pecas = {
            'campo': campo(*cores),
            'cume': cume(cores),
            'beira_baixo': beira_baixo(cores),
            'beira_esq': beira_lado(cores, True),
            'beira_dir': beira_lado(cores, False),
            'canto_esq': canto(cores, True),
            'canto_dir': canto(cores, False),
        }
        for ci, chave in enumerate(PECAS):
            atlas.paste(pecas[chave], (ci * T, li * T))
            indice.setdefault(nome, {})[chave] = [ci * T, li * T, T, T]

    destino = ASSETS / 'roof.png'
    atlas.save(destino)
    import json
    (ASSETS / 'roof.json').write_text(
        json.dumps({'tile': T, 'cores': indice}, indent=2), encoding='utf-8')
    print(f'{destino.relative_to(RAIZ)}  {atlas.width}x{atlas.height}')
    print(f'{len(CORES)} cores x {len(PECAS)} peças: {", ".join(n for n, *_ in CORES)}')


if __name__ == '__main__':
    main()
