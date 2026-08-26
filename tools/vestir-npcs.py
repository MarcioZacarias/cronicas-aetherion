#!/usr/bin/env python3
"""
Gera variantes vestidas dos corpos-base do LPC.

O pacote de arte incluído no projeto traz o CORPO, não o personagem: no LPC,
cabelo e roupa são camadas separadas que a gente não tem aqui. Resultado:
`villager`, `guard` e `soldier` aparecem carecas, e o villager ainda por cima
sem camisa. Numa praça de mercado com oito NPCs isso salta aos olhos.

Este script não desenha formas novas: ele RECOLORE regiões que já existem —
o topo do crânio vira cabelo, a pele do tronco vira túnica, as calças mudam
de cor. É edição derivada da mesma arte, então CREDITS-LPC.txt continua
cobrindo tudo.

Uso:  python tools/vestir-npcs.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ASSETS = RAIZ / 'public' / 'assets'
F = 64  # lado de um quadro

# Faixas verticais dentro de um quadro de 64px. MEDIDAS na arte, linha a
# linha, não estimadas: a silhueta começa em y=15, o rosto ocupa 22..31 e o
# tronco só abre em 36, onde os ombros alargam de 20 para 28 pixels.
CRANIO = (15, 22)   # calota, acima da linha dos olhos
TRONCO = (36, 50)   # ombros até a cintura (não encosta no queixo)
PERNAS = (50, 56)   # entre a cintura e os pés

# (origem, destino, cor do cabelo, cor da túnica, cor da calça)
# Os arquivos de origem NUNCA são sobrescritos: a arte-base do LPC fica
# intacta em disco e este script pode rodar de novo a qualquer momento.
VARIANTES = [
    ('villager', 'villager_a', (58, 38, 22),  (108, 74, 42),  None),
    ('villager', 'villager_b', (32, 26, 22),  (74, 96, 120),  (52, 52, 62)),
    ('villager', 'villager_c', (126, 82, 30), (132, 116, 74), (78, 62, 40)),
    ('guard',    'guard_a',    (44, 32, 24),  None,           None),
    ('guard',    'guard_b',    (96, 70, 34),  None,           None),
    ('soldier',  'soldier_a',  (46, 34, 26),  None,           None),
    # priest fica de fora: já vem robado, e a máscara de pele confunde o
    # tecido da veste com carne, tingindo a figura inteira.
]

# Há uma única figura feminina no pacote para quatro NPCs mulheres. Aqui o
# que muda é o tecido do vestido — tudo que NÃO é pele nem cabelo, do ombro
# ao pé —, preservando rosto e trança.
VESTIDOS = [
    ('princess', 'princess_a', (150, 120, 60)),
    ('princess', 'princess_b', (120, 70, 80)),
    ('princess', 'princess_c', (86, 116, 92)),
]
VESTIDO_FAIXA = (33, 63)


def mascara_pele(rgb):
    """Pele do LPC: tom quente e claro, R > G > B com boa separação."""
    r, g, b = rgb[:, :, 0].astype(int), rgb[:, :, 1].astype(int), rgb[:, :, 2].astype(int)
    return (r > 120) & (r > g + 14) & (g > b + 8) & (b < 190)


def sombrear(cor, fator):
    return tuple(max(0, min(255, int(c * fator))) for c in cor)


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


def main():
    for origem, destino, cabelo, tunica, calca in VARIANTES:
        im = Image.open(ASSETS / f'{origem}.png').convert('RGBA')
        arr = np.array(im).astype(np.uint8)
        alpha = arr[:, :, 3]
        h, w = alpha.shape
        pele = mascara_pele(arr[:, :, :3])

        if cabelo:
            # Só o couro cabeludo: pele na faixa do crânio.
            pintar(arr, alpha, pele & faixa(h, w, *CRANIO), cabelo)
        if tunica:
            pintar(arr, alpha, pele & faixa(h, w, *TRONCO), tunica)
        if calca:
            # Calça: o que NÃO é pele na faixa das pernas.
            pintar(arr, alpha, (~pele) & faixa(h, w, *PERNAS), calca)

        saida = ASSETS / f'{destino}.png'
        Image.fromarray(arr, 'RGBA').save(saida)
        print(f'{destino:<12} <- {origem:<9} cabelo={cabelo} tunica={tunica} calca={calca}')

    for origem, destino, cor in VESTIDOS:
        im = Image.open(ASSETS / f'{origem}.png').convert('RGBA')
        arr = np.array(im).astype(np.uint8)
        alpha = arr[:, :, 3]
        h, w = alpha.shape
        pele = mascara_pele(arr[:, :, :3])
        pintar(arr, alpha, (~pele) & faixa(h, w, *VESTIDO_FAIXA), cor)
        Image.fromarray(arr, 'RGBA').save(ASSETS / f'{destino}.png')
        print(f'{destino:<12} <- {origem:<9} vestido={cor}')


if __name__ == '__main__':
    main()
