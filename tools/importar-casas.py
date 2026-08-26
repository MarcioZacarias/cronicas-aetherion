#!/usr/bin/env python3
"""
Importa as casas prontas do Houses_Pack para public/assets/casas.png.

Por que este pacote resolveu: ele entrega PRÉDIOS INTEIROS vistos de cima
— telhado com fiadas, cumeeira, chaminé, beiral e fachada com porta e
janelas — em vez de peças para montagem manual. Cinco tentativas de
compor prédio a partir dos kits do LPC falharam porque aquela arte foi
desenhada para o artista posicionar peça a peça no Tiled.

Cada casa é recortada por componente conectado, com folga para não cortar
o beiral, e alinhada ao tile de 32. O índice guarda o tamanho em tiles e
a ALTURA DA BASE — a faixa de baixo que é parede/porta, e portanto a
única parte que bloqueia passagem. O telhado acima dela é para se andar
por trás, como uma árvore.

Licença: domínio público (Szadi art), uso pessoal ou comercial livre.

Uso:  python tools/importar-casas.py [caminho/houses.png]
"""

import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ASSETS = RAIZ / 'public' / 'assets'
T = 32
AREA_MINIMA = 4000   # descarta chaminés soltas e detalhes avulsos

# A folha tem 26 peças com área suficiente, mas só nove são CASAS: o resto
# é chaminé, alpendre e fachada de varanda. O recorte por componente não
# sabe distinguir, então a curadoria é explícita — por tamanho em tiles.
#
# (largura, altura) -> nome do tipo, na ordem de cor em que aparecem
TIPOS = {
    (6, 4): 'telhado',   # telhado simples, sem fachada
    (8, 8): 'solar',     # casa em cruz, a maior
    (6, 7): 'chale',     # casa com frontão e óculo
}
CORES = ['roxo', 'cinza', 'vermelho']   # ordem das colunas na folha


def componentes(alpha):
    """Retângulos das peças isoladas na folha."""
    h, w = alpha.shape
    visto = np.zeros_like(alpha, dtype=bool)
    achados = []
    for y0 in range(h):
        for x0 in range(w):
            if not alpha[y0, x0] or visto[y0, x0]:
                continue
            fila = deque([(y0, x0)])
            visto[y0, x0] = True
            xs, ys = [], []
            while fila:
                cy, cx = fila.popleft()
                xs.append(cx); ys.append(cy)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and alpha[ny, nx] and not visto[ny, nx]:
                        visto[ny, nx] = True
                        fila.append((ny, nx))
            if len(xs) >= AREA_MINIMA:
                achados.append((min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1))
    return achados


def altura_da_base(rec):
    """Quantas linhas de tile, de baixo para cima, são parede e não telhado.

    Medida pela LARGURA da silhueta: o telhado é mais largo que a fachada,
    então a base é a faixa final em que a largura para de encolher. Sem
    isso eu teria de chutar, e chutar aqui significa colisão errada.
    """
    a = np.array(rec)[:, :, 3] > 40
    larguras = a.sum(axis=1)
    if not larguras.any():
        return 2
    largura_max = larguras.max()
    # Linha a partir da qual a silhueta fica estreita (< 80% do máximo).
    estreitas = [i for i, v in enumerate(larguras) if 0 < v < largura_max * 0.8]
    if not estreitas:
        return 2
    # A base é o trecho contíguo de linhas estreitas que toca o rodapé.
    ultimo = len(larguras) - 1
    while ultimo > 0 and larguras[ultimo] == 0:
        ultimo -= 1
    inicio = ultimo
    while inicio > 0 and 0 < larguras[inicio - 1] < largura_max * 0.8:
        inicio -= 1
    return max(1, round((ultimo - inicio + 1) / T))


# Casas avulsas: um PNG = uma casa inteira, já desenhada. Entram no mesmo
# atlas, com o tamanho arredondado para cima até fechar tiles de 32.
AVULSAS = RAIZ / 'tiled' / 'ref'

# Ampliação por arquivo. As três casas vêm pequenas: 4,4 tiles de altura
# contra 2 do personagem dá proporção de casebre. A 1,5x ficam 9x7, que é
# altura de casa de verdade e ainda cabe no traçado de Lumera. A 2x seria
# mais limpo (pixel dobrado, sem tamanho desigual), mas dá 11x9 e não cabe.
# A estalagem já vem desenhada maior, e no tamanho de origem fica
# equivalente às outras — ampliá-la a deixaria desproporcional.
ESCALA_AVULSA = {'house1': 1.5, 'house1b': 1.5, 'house1c': 1.5}


def importar_avulsas():
    if not AVULSAS.exists():
        return []
    saida = []
    for arq in sorted(AVULSAS.glob('*.png')):
        im = Image.open(arq).convert('RGBA')
        fator = ESCALA_AVULSA.get(arq.stem, 1.0)
        if fator != 1.0:
            im = im.resize((round(im.width * fator), round(im.height * fator)),
                           Image.NEAREST)
        tw, th = -(-im.width // T), -(-im.height // T)
        tela = Image.new('RGBA', (tw * T, th * T), (0, 0, 0, 0))
        tela.alpha_composite(im, ((tw * T - im.width) // 2, th * T - im.height))
        # Hífen não vale como chave de objeto em JS sem aspas; normaliza.
        saida.append((arq.stem.replace('-', '_'), tela, tw, th, 2))
    return saida


def main():
    origem = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('houses.png')
    if not origem.exists():
        print(f'não achei {origem}')
        return
    folha = Image.open(origem).convert('RGBA')
    alpha = np.array(folha)[:, :, 3] > 40

    pecas = componentes(alpha)
    print(f'{len(pecas)} peças com área >= {AREA_MINIMA}px')

    recortes = []
    for (x, y, w, h) in sorted(pecas, key=lambda p: (p[1], p[0])):
        rec = folha.crop((x, y, x + w, y + h))
        # Alinha ao tile pondo a peça no canto inferior-esquerdo de uma
        # tela múltipla de 32: a base tem de casar com a grade do mundo.
        tw, th = -(-w // T), -(-h // T)
        tela = Image.new('RGBA', (tw * T, th * T), (0, 0, 0, 0))
        tela.alpha_composite(rec, ((tw * T - w) // 2, th * T - h))
        recortes.append((tela, tw, th, altura_da_base(rec)))

    # Só os tamanhos curados entram, batizados por tipo e cor.
    contagem = {}
    curados = []
    for tela, tw, th, base in recortes:
        tipo = TIPOS.get((tw, th))
        if not tipo:
            continue
        i = contagem.get(tipo, 0)
        contagem[tipo] = i + 1
        cor = CORES[i] if i < len(CORES) else f'v{i}'
        curados.append((f'{tipo}_{cor}', tela, tw, th, base))
    descartados = len(recortes) - len(curados)
    curados.extend(importar_avulsas())
    recortes = [(t, w, h, b) for _, t, w, h, b in curados]
    nomes = [n for n, *_ in curados]
    print(f'{descartados} peças descartadas (chaminés, alpendres, fachadas soltas)')

    largura = sum(r[1] for r in recortes)
    altura = max(r[2] for r in recortes)
    atlas = Image.new('RGBA', (largura * T, altura * T), (0, 0, 0, 0))
    indice, ox = {}, 0
    for i, (tela, tw, th, base) in enumerate(recortes):
        atlas.paste(tela, (ox * T, 0))
        indice[nomes[i]] = {
            'x': ox * T, 'y': 0, 'w': tw * T, 'h': th * T,
            'tiles': [tw, th], 'base': base,
        }
        ox += tw

    atlas.save(ASSETS / 'casas.png')
    (ASSETS / 'casas.json').write_text(
        json.dumps({'tile': T, 'casas': indice}, indent=2), encoding='utf-8')
    print(f'casas.png  {atlas.width}x{atlas.height}  {len(indice)} casas')
    for k, v in indice.items():
        print(f'  {k:<8} {v["tiles"][0]}x{v["tiles"][1]} tiles, base de {v["base"]}')


if __name__ == '__main__':
    main()
