#!/usr/bin/env python3
"""
Compõe uma prévia PNG de um trecho do mapa, usando as MESMAS peças e a mesma
ordem de montagem do cliente. Serve para conferir a cidade sem abrir o
navegador — e para flagrar fachada torta antes de ir para produção.

Entrada: JSON gerado pelo dump do mapa (tiles, deco, buildings, props).
Uso:  python tools/previa-cidade.py entrada.json saida.png [zoom]
"""

import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
ASSETS = RAIZ / 'public' / 'assets'
T = 32


def carregar(nome):
    return Image.open(ASSETS / f'{nome}.png').convert('RGBA')


def main():
    entrada = Path(sys.argv[1])
    saida = Path(sys.argv[2])
    zoom = int(sys.argv[3]) if len(sys.argv) > 3 else 2

    d = json.loads(entrada.read_text(encoding='utf-8'))
    x0, y0, x1, y1 = d['x0'], d['y0'], d['x1'], d['y1']
    W, H = (x1 - x0 + 1) * T, (y1 - y0 + 1) * T

    img = Image.new('RGBA', (W, H), (6, 6, 6, 255))
    dr = ImageDraw.Draw(img)

    grass, dirt, dirt2 = carregar('grass'), carregar('dirt'), carregar('dirt2')
    water, wall, rock = carregar('water'), carregar('wall'), carregar('rock')
    grave, chest, tree = carregar('grave'), carregar('chest'), carregar('tree')
    city = carregar('city')
    indice = json.loads((ASSETS / 'city.json').read_text(encoding='utf-8'))['variantes']
    sets_img = carregar('lpc-sets')
    ind_sets = json.loads((ASSETS / 'lpc-sets.json').read_text(encoding='utf-8'))['conjuntos']
    props_img = carregar('lpc-props')
    ind_props = json.loads((ASSETS / 'lpc-props.json').read_text(encoding='utf-8'))['props']
    tel_img = carregar('roof')
    ind_tel = json.loads((ASSETS / 'roof.json').read_text(encoding='utf-8'))['cores']
    humanos = {n: carregar(n) for n in ('guard', 'princess', 'villager',
                                    'guard_a', 'guard_b', 'villager_a', 'villager_b',
                                    'villager_c', 'princess_a', 'princess_b', 'princess_c')}

    def por(im, cx, cy, sx=0, sy=0, sw=T, sh=T):
        img.alpha_composite(im.crop((sx, sy, sx + sw, sy + sh)), (cx, cy))

    chao_de_prop = {(p['x'], p['y']): p.get('chao', 0) for p in d['props']}

    def calcamento(px, py, x, y, v):
        dr.rectangle([px, py, px + T, py + T], fill=(86, 80, 73))
        tons = [(110, 103, 94), (119, 112, 102), (101, 94, 86), (125, 118, 107)]
        for i in range(4):
            lin, col = i // 2, i % 2
            desl = int(T * 0.12) if (lin + v) % 2 else 0
            c = tons[(x * 3 + y * 5 + i + v) % len(tons)]
            dr.rectangle([px + col * T // 2 + desl + 1, py + lin * T // 2 + 1,
                          px + col * T // 2 + desl + T // 2 - 2, py + lin * T // 2 + T // 2 - 2], fill=c)

    def fatia9(cx, cy, w, h):
        v = 'n' if cy == 0 else ('s' if cy == h - 1 else '')
        hh = 'w' if cx == 0 else ('e' if cx == w - 1 else '')
        return (v + hh) or 'meio'

    def peca_set(chave, fatia, cx, cy):
        c = ind_sets.get(chave)
        if not c:
            return False
        p = c['fatias'].get(fatia)
        if not p:
            return False
        sx, sy, sw, sh = p
        img.alpha_composite(sets_img.crop((sx, sy, sx + sw, sy + sh)), (cx, cy))
        return True


    # calcada entra com a maior precedência: ela nunca faz transição
    # com terreno natural (é chão de cidade, com borda própria).
    PRECEDENCIA = {'agua': 0, 'areia': 1, 'terra': 2, 'grama': 3, 'calcada': 4}
    PARES_TERRENO = {
        'grama|terra': 'terreno:grama_terra', 'grama|areia': 'terreno:grama_areia',
        'areia|agua': 'terreno:areia_agua', 'terra|areia': 'terreno:terra_areia',
    }
    PREENCH = {'grama': 'terreno:grama_terra', 'terra': 'terreno:terra_areia',
               'areia': 'terreno:areia_agua'}

    def familia(t):
        if t == 2: return 'agua'
        if t == 5: return 'areia'
        if t in (1, 12): return 'terra'
        if t == 18: return 'calcada'
        return 'grama'

    def fam_em(i, j):
        if 0 <= j < len(d['tiles']) and 0 <= i < len(d['tiles'][0]):
            return familia(d['tiles'][j][i])
        return None

    def terreno(i, j, px, py):
        fam = familia(chao_de(i, j))
        if fam not in PREENCH:
            return False
        viz = {'n': fam_em(i, j - 1), 's': fam_em(i, j + 1),
               'w': fam_em(i - 1, j), 'e': fam_em(i + 1, j)}
        menores = {k: v for k, v in viz.items()
                   if v and v != fam and PRECEDENCIA[v] < PRECEDENCIA[fam]}
        if not menores:
            return peca_set(PREENCH[fam], 'meio', px, py)
        chave = PARES_TERRENO.get(fam + '|' + list(menores.values())[0])
        if not chave or chave not in ind_sets:
            return peca_set(PREENCH[fam], 'meio', px, py)
        v = 'n' if 'n' in menores else ('s' if 's' in menores else '')
        h = 'w' if 'w' in menores else ('e' if 'e' in menores else '')
        return peca_set(chave, (v + h) or 'meio', px, py)

    def chao_de(i, j):
        t = d['tiles'][j][i]
        if t == 19:
            return chao_de_prop.get((x0 + i, y0 + j), 0)
        if t == 17:
            return 1
        return t

    # ---- chão ----
    for j, linha in enumerate(d['tiles']):
        for i, t in enumerate(linha):
            x, y = x0 + i, y0 + j
            px, py = i * T, j * T
            v = d['deco'][j][i]
            if t == 2:
                por(water, px, py, 0, 160); continue
            if t == 13:
                por(wall, px, py); continue
            chao = t
            if t == 19:
                chao = chao_de_prop.get((x, y), 0)
            elif t == 17:
                chao = 1
            if chao == 18:
                if not peca_set('piso:cinza', 'meio', px, py):
                    calcamento(px, py, x, y, v)
            elif not terreno(i, j, px, py):
                if chao == 5:
                    por(dirt2, px, py, (v % 3) * T, 160)
                elif chao in (1, 12):
                    por(dirt, px, py, (v % 3) * T, 160)
                else:
                    por(grass, px, py, (v % 3) * T, 160)
            if t == 7: por(rock, px, py)
            if t == 15: por(grave, px, py)
            if t == 4: por(chest, px, py)
            if t == 14:
                dr.rectangle([px + 2, py, px + T - 2, py + T], fill=(74, 48, 24))
                for k, c in enumerate([(160,64,64),(64,96,160),(160,160,64),(64,160,96)]):
                    dr.rectangle([px + 4 + k * 6, py + 3, px + 8 + k * 6, py + T - 6], fill=c)

    # ---- camada ordenada por Y ----
    fila = []

    for j, linha in enumerate(d['tiles']):
        for i, t in enumerate(linha):
            if t == 3:
                fila.append(((y0 + j) * T, ('arvore', i, j)))

    for b in d['buildings']:
        fila.append(((b['y'] + b['h']) * T, ('predio', b, None)))
    for p in d['props']:
        fila.append(((p['y'] + 1) * T, ('prop', p, None)))
    for n in d['npcs']:
        fila.append((n['y'] * T, ('npc', n, None)))

    fila.sort(key=lambda e: e[0])

    def peca(variante, nome, cx, cy):
        p = indice.get(variante, indice['house']).get(nome)
        if not p:
            return
        sx, sy, sw, sh = p
        img.alpha_composite(city.crop((sx, sy, sx + sw, sy + sh)), (cx, cy))


    CORES = {
        'armaria': ((140, 59, 46), (240, 208, 96)), 'botica': ((61, 122, 82), (143, 224, 160)),
        'banco': ((47, 74, 122), (154, 192, 240)), 'prefeitura': ((90, 74, 122), (200, 176, 240)),
        'templo': ((106, 90, 140), (203, 184, 255)), 'estacao': ((122, 90, 46), (224, 192, 128)),
        'taverna': ((122, 74, 36), (232, 176, 112)), 'biblioteca': ((74, 90, 122), (168, 192, 224)),
    }

    def letreiro(b):
        toldo, cor_nome = CORES.get(b['tipo'], CORES['armaria'])
        px = (b['x'] - x0 + b['porta']) * T
        py = (b['y'] - y0 + b['h'] - 3) * T
        # toldo listrado sobre a porta
        dr.rectangle([px - T * .14, py + T * .72, px + T * 1.14, py + T * 1.02], fill=toldo)
        for i in range(4):
            xx = px - T * .14 + T * (.16 + i * .32)
            dr.rectangle([xx, py + T * .72, xx + T * .16, py + T * 1.02], fill=(240, 236, 224))
        # tabuleta ao lado
        sx, sy = px + T * 1.05, py + T * .28
        dr.rectangle([px + T * .9, py + T * .2, px + T * 1.3, py + T * .27], fill=(58, 49, 40))
        dr.rectangle([sx, sy + T * .08, sx + T * .56, sy + T * .52], fill=(90, 64, 32))
        dr.rectangle([sx + T * .04, sy + T * .12, sx + T * .52, sy + T * .48], fill=(122, 90, 48))
        # nome acima do telhado
        nome = b.get('nome')
        if nome:
            nx = (b['x'] - x0 + b['w'] / 2) * T
            ny = (b['y'] - y0) * T - 12
            larg = len(nome) * 6
            dr.rectangle([nx - larg / 2 - 3, ny - 2, nx + larg / 2 + 3, ny + 11], fill=(0, 0, 0))
            dr.text((nx - larg / 2, ny), nome, fill=cor_nome)

    for _, (tipo, a, b_) in fila:
        if tipo == 'arvore':
            i, j = a, b_
            img.alpha_composite(tree.crop((0, 0, 96, 144)), (i * T - 32, j * T - 112))
        elif tipo == 'predio':
            b = a
            linhas = b['h'] - 2
            cumeeira = max(0, (linhas - 1) // 2)
            cor = ind_tel.get(b.get('telhado')) or ind_tel['telha']
            sombra = Image.new('RGBA', (b['w'] * T + 6, 12), (0, 0, 0, 72))
            img.alpha_composite(sombra, ((b['x'] - x0) * T + 6,
                                         (b['y'] - y0 + b['h']) * T - 10))
            larg = b['w'] + 2
            for cy in range(linhas):
                for cxj in range(larg):
                    cxi = cxj - 1
                    esq, dire = cxj == 0, cxj == larg - 1
                    baixo = cy == linhas - 1
                    if baixo and esq: nome = 'canto_esq'
                    elif baixo and dire: nome = 'canto_dir'
                    elif baixo: nome = 'beira_baixo'
                    elif cy == cumeeira: nome = 'cume'
                    elif esq: nome = 'beira_esq'
                    elif dire: nome = 'beira_dir'
                    else: nome = 'campo_topo' if cy < cumeeira else 'campo'
                    pc = cor.get(nome)
                    if pc:
                        img.alpha_composite(
                            tel_img.crop((pc[0], pc[1], pc[0] + pc[2], pc[1] + pc[3])),
                            ((b['x'] - x0 + cxi) * T, (b['y'] - y0 + cy) * T))
            parede_y = b['y'] - y0 + b['h'] - 2
            for cy in range(2):
                for cxi in range(b['w']):
                    peca_set('parede:' + b.get('parede', 'palha'), 'meio',
                             (b['x'] - x0 + cxi) * T, (parede_y + cy) * T)
            pr = ind_props.get('porta')
            if pr:
                img.alpha_composite(
                    props_img.crop((pr['x'], pr['y'], pr['x'] + pr['w'], pr['y'] + pr['h'])),
                    ((b['x'] - x0 + b['porta']) * T, parede_y * T))
            jn = ind_props.get('janela')
            if jn:
                for cxi in b.get('janelas', []):
                    if cxi == b['porta']:
                        continue
                    img.alpha_composite(
                        props_img.crop((jn['x'], jn['y'], jn['x'] + jn['w'], jn['y'] + jn['h'])),
                        ((b['x'] - x0 + cxi) * T, (parede_y + 1) * T))
            if b.get('tipo'):
                letreiro(b)
        elif tipo == 'prop':
            p = a
            px, py = (p['x'] - x0) * T, (p['y'] - y0) * T
            r = lambda fx, fy, fw, fh, c: dr.rectangle(
                [px + T * fx, py + T * fy, px + T * (fx + fw), py + T * (fy + fh)], fill=c)
            k = p['t']
            if k in ind_props:
                a2 = ind_props[k]
                tw, th = a2['tiles']
                img.alpha_composite(
                    props_img.crop((a2['x'], a2['y'], a2['x'] + a2['w'], a2['y'] + a2['h'])),
                    (px, py - (th - 1) * T))
            elif k == '_vazio':
                pass
            elif k == 'fonte':
                L, A = T * p.get('w', 2), T * p.get('h', 2)
                cx, cy = px + L // 2, py + A // 2
                dr.ellipse([cx - L * .46, cy - A * .34, cx + L * .46, cy + A * .46], fill=(93, 87, 79))
                dr.ellipse([cx - L * .44, cy - A * .38, cx + L * .44, cy + A * .38], fill=(138, 133, 124))
                dr.ellipse([cx - L * .34, cy - A * .28, cx + L * .34, cy + A * .28], fill=(52, 114, 180))
                dr.rectangle([cx - L * .06, cy - A * .30, cx + L * .06, cy + A * .04], fill=(154, 148, 138))
                dr.rectangle([cx - L * .03, cy - A * .44, cx + L * .03, cy - A * .26], fill=(200, 232, 250))
                dr.ellipse([cx - L * .15, cy - A * .35, cx + L * .15, cy - A * .25], fill=(200, 232, 250))
            elif k == 'poco':
                r(.1, .35, .8, .55, (122, 113, 104)); r(.2, .45, .6, .4, (27, 36, 48))
                r(.14, .05, .72, .16, (90, 58, 26)); r(.44, .18, .12, .24, (74, 48, 24))
            elif k == 'lampiao':
                alt = int(T * 1.1)
                r(.4, .35, .2, .62, (46, 40, 31))
                dr.rectangle([px + T * .44, py + T * .9 - alt, px + T * .56, py + T * .35], fill=(58, 49, 40))
                ly = py + T * .9 - alt
                dr.rectangle([px + T * .32, ly, px + T * .68, ly + T * .34], fill=(42, 36, 26))
                dr.rectangle([px + T * .37, ly + T * .05, px + T * .63, ly + T * .29], fill=(255, 222, 140))
                dr.rectangle([px + T * .28, ly - T * .08, px + T * .72, ly], fill=(58, 49, 40))
            elif k == 'banca':
                r(.05, .5, .9, .42, (107, 74, 36)); r(.05, .44, .9, .1, (138, 96, 52))
                for i2 in range(5):
                    r(.05 + i2 * .18, .06, .18, .34, (192, 74, 58) if i2 % 2 else (232, 220, 192))
                r(.05, .38, .9, .08, (74, 48, 24))
            elif k == 'engradado':
                r(.08, .18, .84, .74, (138, 96, 52)); r(.14, .24, .72, .62, (107, 74, 36))
                r(.08, .5, .84, .08, (74, 48, 24)); r(.46, .18, .08, .74, (74, 48, 24))
            elif k == 'banco':
                r(.06, .42, .88, .16, (122, 90, 52)); r(.06, .3, .88, .1, (138, 106, 60))
                r(.12, .58, .1, .28, (74, 58, 36)); r(.78, .58, .1, .28, (74, 58, 36))
            elif k == 'barril':
                r(.16, .16, .68, .76, (122, 82, 40)); r(.16, .3, .68, .08, (58, 40, 16))
                r(.16, .66, .68, .08, (58, 40, 16)); r(.24, .16, .52, .1, (154, 106, 56))
            elif k == 'arvorinha':
                img.alpha_composite(grass.crop((0, 0, T, T)), (px, py - 8))
                img.alpha_composite(grass.crop((0, 0, T, T)), (px, py))
            elif k == 'torre':
                dr.rectangle([px - 4, py - int(T * 1.5), px + T + 4, py + int(T * 1.0)], fill=(74, 71, 64))
                dr.rectangle([px - 1, py - int(T * 1.4), px + T + 1, py + int(T * .9)], fill=(106, 102, 92))
                for i2 in range(4):
                    dr.rectangle([px + int(T * (.02 + i2 * .28)), py - int(T * 1.62),
                                  px + int(T * (.18 + i2 * .28)), py - int(T * 1.36)], fill=(58, 55, 48))
                dr.rectangle([px + int(T * .38), py - int(T * .9),
                              px + int(T * .62), py - int(T * .5)], fill=(27, 36, 48))
        elif tipo == 'npc':
            n = a
            im = humanos.get(n['img'], humanos['villager_a'])
            img.alpha_composite(im.crop((0, 2 * 64, 64, 3 * 64)), ((n['x'] - x0) * T - 16, (n['y'] - y0) * T - 32))

    fora = img.convert('RGB').resize((W * zoom, H * zoom), Image.NEAREST)
    fora.save(saida)
    print(f'{saida}  {fora.width}x{fora.height}  ({x1-x0+1}x{y1-y0+1} tiles, zoom {zoom}x)')


if __name__ == '__main__':
    main()
