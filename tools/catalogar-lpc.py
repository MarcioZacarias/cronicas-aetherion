#!/usr/bin/env python3
"""
Cataloga os pacotes LPC baixados em ~/Downloads.

Motivo: cada zip do LPC traz dezenas de PNGs sem um índice legível, e
alguns vêm com um .tsx do Tiled onde os tiles TÊM nome. Abrir um a um no
olho não escala. Este script extrai tudo para uma pasta de trabalho,
mede cada folha e, quando existe .tsx, lê os nomes dos tiles.

Uso:  python tools/catalogar-lpc.py [pasta_de_downloads] [pasta_destino]
"""

import json
import os
import re
import struct
import sys
import zipfile
from pathlib import Path

# Aceita "lpc-x.zip", "lpc_x.zip" e "lpc overworld.zip" — os nomes vêm do
# OpenGameArt e não seguem convenção nenhuma.
PADRAO = re.compile(r'^lpc[-_ ].*\.zip$', re.I)


def dimensoes_png(dados):
    if dados[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    w, h = struct.unpack('>II', dados[16:24])
    return w, h


def nomes_do_tsx(texto):
    """Extrai id -> nome das propriedades de tile de um tileset do Tiled."""
    nomes = {}
    for m in re.finditer(r'<tile\s+id="(\d+)"(.*?)</tile>', texto, re.S):
        tid, corpo = int(m.group(1)), m.group(2)
        p = re.search(r'name="(?:name|Name)"\s+value="([^"]+)"', corpo)
        if not p:
            p = re.search(r'<property\s+name="[^"]*"\s+value="([^"]+)"', corpo)
        if p:
            nomes[tid] = p.group(1)
    return nomes


def main():
    downloads = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / 'Downloads'
    destino = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('assets-lpc')
    destino.mkdir(parents=True, exist_ok=True)

    catalogo = {}
    zips = sorted(p for p in downloads.glob('*.zip') if PADRAO.match(p.name))
    if not zips:
        print(f'nenhum zip lpc-*.zip em {downloads}')
        return

    for z in zips:
        pacote = z.stem
        pasta = destino / pacote
        pasta.mkdir(exist_ok=True)
        folhas, creditos, tsx = [], [], {}
        with zipfile.ZipFile(z) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                # Metadados do macOS entram no zip e não são conteúdo.
                if '__MACOSX' in info.filename or Path(info.filename).name.startswith('._'):
                    continue
                dados = zf.read(info)
                # Preserva a hierarquia achatada com "__": vários pacotes têm
                # arquivos de mesmo nome em pastas diferentes (hair/black.png
                # e hair/masks/black.png), e usar só o nome final perdia
                # centenas de folhas silenciosamente.
                partes = [p for p in Path(info.filename).parts if p not in ('.', '..')]
                nome = '__'.join(partes[1:] if len(partes) > 1 else partes)
                baixo = nome.lower()
                if baixo.endswith('.png'):
                    dim = dimensoes_png(dados)
                    if not dim:
                        continue
                    (pasta / nome).write_bytes(dados)
                    folhas.append({
                        'arquivo': nome, 'w': dim[0], 'h': dim[1],
                        'tiles': (dim[0] // 32) * (dim[1] // 32),
                        'grade': f'{dim[0] // 32}x{dim[1] // 32}',
                    })
                elif baixo.endswith('.tsx'):
                    (pasta / nome).write_bytes(dados)
                    tsx[nome] = nomes_do_tsx(dados.decode('utf-8', 'replace'))
                elif 'credit' in baixo or baixo.endswith('.txt'):
                    (pasta / nome).write_bytes(dados)
                    creditos.append(nome)

        catalogo[pacote] = {
            'folhas': sorted(folhas, key=lambda f: -f['tiles']),
            'creditos': creditos,
            'tsx': {k: len(v) for k, v in tsx.items()},
            'nomes': tsx,
        }
        total = sum(f['tiles'] for f in folhas)
        print(f'{pacote:<24} {len(folhas):>3} folhas, {total:>5} tiles de 32px'
              + (f", {sum(len(v) for v in tsx.values())} tiles nomeados" if tsx else ''))

    (destino / 'catalogo.json').write_text(
        json.dumps(catalogo, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'\ncatálogo em {destino / "catalogo.json"}')

    # Um resumo do que é grande o bastante para valer integração.
    print('\nmaiores folhas:')
    todas = [(p, f) for p, d in catalogo.items() for f in d['folhas']]
    for pacote, f in sorted(todas, key=lambda t: -t[1]['tiles'])[:18]:
        print(f"  {f['tiles']:>5} tiles  {f['grade']:>8}  {pacote}/{f['arquivo']}")


if __name__ == '__main__':
    main()
