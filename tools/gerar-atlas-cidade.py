#!/usr/bin/env python3
"""
Gera public/assets/city.png a partir das fachadas LPC já presentes no projeto.

Por que isto existe: house.png, house2.png e chapel.png são o MESMO prédio em
três cores, desenhados como um bloco fechado de 160x160. Carimbar esse bloco
faz toda cidade parecer o mesmo quarteirão repetido.

As fachadas, porém, são modulares por construção:

    y   0.. 8  ameias (parapeito)
    y   8..80  parede de tijolo
    y  80..96  cornija de pedra
    y  96..160 embasamento de pedra, com porta e janelas

    x   0..32  cantoneira esquerda        x 128..160 cantoneira direita
    x  64..96  PORTA (um tile exato)
    janelas centradas em x=36 e x=124

Recortando essas partes dá para compor prédios de qualquer largura e altura.
Nenhum pixel novo é desenhado: tudo aqui é recorte, espelhamento e repetição
da arte LPC original, então a atribuição em CREDITS-LPC.txt continua valendo.

Uso:  python tools/gerar-atlas-cidade.py
"""

from PIL import Image
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ASSETS = RAIZ / 'public' / 'assets'
T = 32  # lado do tile

# Cada fachada vira uma "variante" de prédio.
VARIANTES = ['house', 'house2', 'chapel']

# Peças recortadas de cada fachada. Nome -> (x, y, largura, altura).
# Todas com 32 de largura; altura 32 ou 64 (peças de dois tiles).
PECAS = {
    # topo: ameias + começo do tijolo
    'topo':        (48, 0, 32, 32),
    # parede lisa, sem nenhum detalhe
    'parede':      (48, 40, 32, 32),
    # cornija: faixa clara que separa o tijolo do embasamento
    'cornija':     (48, 64, 32, 32),
    # cantoneira: coluna de blocos de pedra da quina do prédio
    'canto':       (0, 40, 32, 32),
    'canto_topo':  (0, 0, 32, 32),
    # embasamento com janela (recorte centrado na janela esquerda, x=36)
    'base_janela': (20, 96, 32, 64),
    # porta dupla de madeira: já vem alinhada ao tile
    'porta':       (64, 96, 32, 64),
}

# O embasamento liso só existe em trechos estreitos (16px) entre as aberturas.
# Montamos um tile de 32 repetindo esse trecho.
BASE_LISA_ORIGEM = (48, 96, 16, 64)

# Só existe janela no embasamento de pedra; o andar de cima é tijolo cru.
# Um prédio de 6 tiles de altura vira um paredão sem nada. Recortamos o
# vidro da janela (medido: x 24..48, y 112..140) e o assentamos sobre o
# tijolo, o que dá um segundo andar sem inventar pixel nenhum.
VIDRO_ORIGEM = (24, 112, 24, 28)


def fatiar(img, caixa):
    x, y, w, h = caixa
    return img.crop((x, y, x + w, y + h))


def base_lisa(img):
    x, y, w, h = BASE_LISA_ORIGEM
    tira = img.crop((x, y, x + w, y + h))
    fora = Image.new('RGBA', (T, h))
    fora.paste(tira, (0, 0))
    # espelha a segunda metade para a emenda no meio não ficar visível
    fora.paste(tira.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
    return fora


def parede_com_janela(img):
    parede = fatiar(img, PECAS['parede']).copy()
    vidro = fatiar(img, VIDRO_ORIGEM)
    parede.paste(vidro, ((T - vidro.width) // 2, (T - vidro.height) // 2))
    return parede


def main():
    ordem = list(PECAS.keys()) + ['base', 'parede_janela']
    # altura de cada coluna em tiles (as peças de porta/janela têm 2)
    altura_tiles = {n: (PECAS[n][3] // T if n in PECAS else (2 if n == 'base' else 1))
                    for n in ordem}
    linhas = len(VARIANTES)
    colunas = len(ordem)
    atlas = Image.new('RGBA', (colunas * T, linhas * 2 * T), (0, 0, 0, 0))

    mapa = {}
    for iv, variante in enumerate(VARIANTES):
        origem = Image.open(ASSETS / f'{variante}.png').convert('RGBA')
        for ic, nome in enumerate(ordem):
            if nome == 'base':
                peca = base_lisa(origem)
            elif nome == 'parede_janela':
                peca = parede_com_janela(origem)
            else:
                peca = fatiar(origem, PECAS[nome])
            dx, dy = ic * T, iv * 2 * T
            atlas.paste(peca, (dx, dy))
            mapa.setdefault(variante, {})[nome] = [dx, dy, T, altura_tiles[nome] * T]

    destino = ASSETS / 'city.png'
    atlas.save(destino)
    print(f'{destino.relative_to(RAIZ)}  {atlas.width}x{atlas.height}')
    print(f'{linhas} variantes x {colunas} peças')

    # O cliente precisa saber onde cada peça ficou.
    import json
    idx = ASSETS / 'city.json'
    idx.write_text(json.dumps({'tile': T, 'variantes': mapa}, indent=2), encoding='utf-8')
    print(f'{idx.relative_to(RAIZ)}  índice das peças')
    for nome in ordem:
        x, y, w, h = mapa[VARIANTES[0]][nome]
        print(f'   {nome:<12} {w}x{h}')


if __name__ == '__main__':
    main()
