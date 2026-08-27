#!/usr/bin/env python3
"""
Gera public/assets/castelo-mini.png: o castelo recortado do gramado e
reduzido à metade (40x30 -> 20x15 tiles), para viver DENTRO do mapa da
cidade como cenário, em vez de ser um mapa separado.

O exterior.png vem com o gramado pintado no fundo (rgb 61,91,28 dominante).
Colar a imagem inteira sobre a grama LPC criaria um retângulo de outro
verde. O recorte remove os verdes de grama por cor; o castelo em si é
pedra cinza, telha vermelha e madeira — nenhum se parece com o fundo.

A redução usa NEAREST: pixel art reduzida com filtro suave vira borrão.

Uso:  python tools/gerar-castelo-mini.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ORIGEM = RAIZ / 'public' / 'assets' / 'mapas' / 'castelo.png'
DESTINO = RAIZ / 'public' / 'assets' / 'castelo-mini.png'


def main():
    im = Image.open(ORIGEM).convert('RGBA')
    a = np.array(im)
    r = a[:, :, 0].astype(int)
    g = a[:, :, 1].astype(int)
    b = a[:, :, 2].astype(int)

    # Grama: verde saturado e dominante. As pedras cinza-esverdeadas do
    # castelo têm g ~= r, então não caem na máscara.
    grama = (g > r + 12) & (g > b + 22) & (g > 55) & (r < 130)
    # Vizinhança da cor exata do fundo, mesmo pouco saturada (sombras).
    fundo = (np.abs(r - 61) < 26) & (np.abs(g - 91) < 30) & (np.abs(b - 28) < 26)

    a[:, :, 3] = np.where(grama | fundo, 0, a[:, :, 3])

    rec = Image.fromarray(a, 'RGBA')
    mini = rec.resize((rec.width // 2, rec.height // 2), Image.NEAREST)
    mini.save(DESTINO)

    op = np.array(mini)[:, :, 3] > 0
    print(f'{DESTINO.name}: {mini.width}x{mini.height} '
          f'({mini.width // 32}x{mini.height // 32} tiles), '
          f'{op.mean() * 100:.0f}% opaco')


if __name__ == '__main__':
    main()
