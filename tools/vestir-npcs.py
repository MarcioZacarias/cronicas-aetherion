#!/usr/bin/env python3
"""
Monta as variantes de personagem: corpo base + roupa + CABELO de verdade.

O pacote base do LPC traz o CORPO, não o personagem — no LPC, cabelo e
roupa são camadas separadas. Por isso `villager`, `guard` e `soldier`
apareciam carecas, e o villager ainda por cima sem camisa.

Duas correções distintas aqui:

1. CABELO — vem do pacote lpc-hair, que publica cada penteado no formato
   "universal" de 13x21 quadros. As linhas 8..11 desse formato são
   exatamente o walkcycle de 9x4 que este jogo usa, então basta recortar
   essa faixa e sobrepor. É arte real, não remendo.

2. CAMISA — para o torso não existe camada no pacote que temos. Aqui
   continua o recurso de RECOLORIR a pele do tronco, medido na arte
   (tronco em y=36..50 dentro do quadro de 64). É remendo assumido: com o
   pacote de roupas do LPC isso deveria ser trocado por camada real.

Uso:  python tools/vestir-npcs.py [pasta_dos_pacotes]
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ASSETS = RAIZ / 'public' / 'assets'
F = 64  # lado de um quadro

# Faixas verticais dentro de um quadro de 64px. MEDIDAS na arte, linha a
# linha: a silhueta começa em y=15, o rosto ocupa 22..31 e o tronco só
# abre em 36, onde os ombros alargam de 20 para 28 pixels.
TRONCO = (36, 50)
PERNAS = (50, 56)

# No formato universal (13 colunas x 21 linhas), as linhas 8..11 são o
# ciclo de caminhada nas quatro direções, com 9 quadros cada.
WALK_LINHA0, WALK_LINHAS, WALK_COLS = 8, 4, 9

# (destino, corpo base, estilo de cabelo, cor do cabelo, cor da túnica, cor da calça)
VARIANTES = [
    ('villager_a', 'villager', 'messy3',    'light_brown', (108, 74, 42),  None),
    ('villager_b', 'villager', 'buzzcut',   'black',        (74, 96, 120),  (52, 52, 62)),
    ('villager_c', 'villager', 'cowlick',   'ginger',      (132, 116, 74), (78, 62, 40)),
    ('guard_a',    'guard',    'high_and_tight', 'dark_brown', None,        None),
    ('guard_b',    'guard',    'flat_top_fade',  'gold',       None,        None),
    ('soldier_a',  'soldier',  'curtains',  'chestnut',    None,           None),
]

# A princesa já vem com cabelo e vestido; aqui só muda o tecido.
VESTIDOS = [
    ('princess_a', 'princess', (150, 120, 60)),
    ('princess_b', 'princess', (120, 70, 80)),
    ('princess_c', 'princess', (86, 116, 92)),
]
VESTIDO_FAIXA = (33, 63)


def mascara_pele(rgb):
    """Pele do LPC: tom quente e claro, R > G > B com boa separação."""
    r, g, b = rgb[:, :, 0].astype(int), rgb[:, :, 1].astype(int), rgb[:, :, 2].astype(int)
    return (r > 120) & (r > g + 14) & (g > b + 8) & (b < 190)


def pintar(arr, alpha, mascara, cor):
    """Aplica a cor preservando o sombreado original do pixel."""
    lum = arr[:, :, :3].mean(axis=2, keepdims=True) / 190.0
    alvo = np.array(cor, dtype=float).reshape(1, 1, 3) * np.clip(lum, 0.45, 1.25)
    sel = mascara & (alpha > 0)
    arr[:, :, :3] = np.where(sel[:, :, None], np.clip(alvo, 0, 255), arr[:, :, :3])


def faixa(h, w, y0, y1):
    """Máscara booleana das linhas y0..y1 dentro de CADA quadro de 64px."""
    m = np.zeros((h, w), dtype=bool)
    for topo in range(0, h, F):
        m[topo + y0: topo + y1, :] = True
    return m


def cabelo_walkcycle(base, estilo, sexo, cor):
    """Recorta a faixa de caminhada do formato universal (13x21 quadros)."""
    caminho = base / 'lpc-hair' / f'hair__{estilo}__{sexo}__{cor}.png'
    if not caminho.exists():
        return None, f'cabelo ausente: {caminho.name}'
    folha = Image.open(caminho).convert('RGBA')
    esperado = (13 * F, 21 * F)
    if folha.size != esperado:
        return None, f'{caminho.name}: esperava {esperado}, veio {folha.size}'
    return folha.crop((0, WALK_LINHA0 * F,
                       WALK_COLS * F, (WALK_LINHA0 + WALK_LINHAS) * F)), None


def main():
    base = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('assets-lpc')
    avisos = []

    for destino, corpo, estilo, cor_cabelo, tunica, calca in VARIANTES:
        im = Image.open(ASSETS / f'{corpo}.png').convert('RGBA')
        arr = np.array(im).astype(np.uint8)
        alpha = arr[:, :, 3]
        h, w = alpha.shape
        pele = mascara_pele(arr[:, :, :3])

        if tunica:
            pintar(arr, alpha, pele & faixa(h, w, *TRONCO), tunica)
        if calca:
            pintar(arr, alpha, (~pele) & faixa(h, w, *PERNAS), calca)

        saida = Image.fromarray(arr, 'RGBA')
        cab, erro = cabelo_walkcycle(base, estilo, 'male', cor_cabelo)
        if erro:
            avisos.append(erro)
        elif cab.size != saida.size:
            avisos.append(f'{destino}: cabelo {cab.size} != corpo {saida.size}')
        else:
            saida.alpha_composite(cab)

        saida.save(ASSETS / f'{destino}.png')
        print(f'{destino:<12} <- {corpo:<9} cabelo={estilo}/{cor_cabelo}'
              + (f' tunica={tunica}' if tunica else ''))

    for destino, corpo, cor in VESTIDOS:
        im = Image.open(ASSETS / f'{corpo}.png').convert('RGBA')
        arr = np.array(im).astype(np.uint8)
        alpha = arr[:, :, 3]
        h, w = alpha.shape
        pele = mascara_pele(arr[:, :, :3])
        pintar(arr, alpha, (~pele) & faixa(h, w, *VESTIDO_FAIXA), cor)
        Image.fromarray(arr, 'RGBA').save(ASSETS / f'{destino}.png')
        print(f'{destino:<12} <- {corpo:<9} vestido={cor}')

    for a in avisos:
        print('  AVISO:', a)


if __name__ == '__main__':
    main()
