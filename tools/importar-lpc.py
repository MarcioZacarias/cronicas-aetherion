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

# Referências para batizar um conjunto pela cor que ele REALMENTE tem.
PALETA = [
    ('vermelho', (150, 45, 30)), ('azul', (45, 80, 170)), ('verde', (30, 95, 60)),
    ('marrom', (130, 85, 50)), ('roxo', (85, 70, 105)), ('cinza', (105, 110, 112)),
    ('ardosia', (78, 84, 94)), ('creme', (205, 195, 170)), ('palha', (190, 165, 120)),
    ('branco', (225, 225, 220)), ('preto', (55, 55, 60)),
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

        cor = nomear_por_cor(recortes['meio'])
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
