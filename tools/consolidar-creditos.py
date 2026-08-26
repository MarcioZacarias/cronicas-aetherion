#!/usr/bin/env python3
"""
Consolida os CREDITS-*.txt dos pacotes LPC efetivamente usados no jogo.

Não é burocracia: o README do pacote de preview é explícito em exigir a
atribuição de TODOS os autores originais — não só de quem remixou — e a
distribuição dos CREDITS-*.txt junto com a arte. São submissões distintas
do OpenGameArt, cada uma com seus autores e sua licença. Sem isso,
estaríamos redistribuindo em violação da CC-BY-SA.

Este script só junta os créditos das folhas que o jogo realmente importa,
listadas em USADOS. Ao acrescentar arte nova, acrescente aqui também.

Uso:  python tools/consolidar-creditos.py [pasta_dos_pacotes]
"""

import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

# (arquivo de créditos, do que ele trata no jogo)
USADOS = [
    ('lpc_base_assets/CREDITS.TXT',
     'Sprites de personagens, monstros, terreno e objetos do jogo original'),
    ('lpc-victorian-preview-see-readme/CREDITS-roofs.txt',
     'Telhados (public/assets/lpc-sets.png, conjuntos "telhado:*")'),
    ('lpc-victorian-preview-see-readme/CREDITS-bricks.txt',
     'Calçamento e alvenaria (lpc-sets.png, conjuntos "piso:*" e "parede:*")'),
]

# O Houses_Pack não vem dos pacotes LPC e tem licença própria, então entra
# como texto fixo. Crédito não é exigido, mas é devido: são as casas que o
# jogo usa em todas as cidades.
EXTRAS = [
    ('Houses Pack — Szadi art',
     'Todos os prédios do jogo (public/assets/casas.png)',
     """Artwork created by Szadi art.

Licença: domínio público, livre para uso pessoal ou comercial.
Crédito não é exigido, mas é apreciado. Permitido editar; proibido
revender o pacote de assets.

https://szadiart.itch.io"""),
]

CABECALHO = """CRÉDITOS DE ARTE — Crônicas de Aetherion
========================================

Toda a arte deste jogo vem do ecossistema Liberated Pixel Cup (LPC) e de
remixes publicados no OpenGameArt. O código é MIT; a ARTE NÃO É — ela
segue as licenças abaixo, e a maioria é CC-BY-SA, que exige atribuição e
obriga trabalhos derivados a manter a mesma licença.

Arquivos derivados gerados por ferramentas deste repositório
(public/assets/city.png, roof.png, lpc-sets.png e as variantes vestidas
dos personagens) são RECORTES E RECOLORAÇÕES da arte abaixo. Continuam
cobertos por estes mesmos créditos e licenças.

Gerado por tools/consolidar-creditos.py — não edite à mão.

"""


def main():
    base = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('assets-lpc')
    partes = [CABECALHO]
    faltando = []

    for rel, para_que in USADOS:
        caminho = base / rel
        if not caminho.exists():
            faltando.append(rel)
            continue
        texto = caminho.read_text(encoding='utf-8', errors='replace').strip()
        partes.append('=' * 78)
        partes.append(f'ORIGEM: {rel}')
        partes.append(f'USADO EM: {para_que}')
        partes.append('=' * 78)
        partes.append('')
        partes.append(texto)
        partes.append('')
        partes.append('')

    for titulo, para_que, texto in EXTRAS:
        partes.append('=' * 78)
        partes.append(f'ORIGEM: {titulo}')
        partes.append(f'USADO EM: {para_que}')
        partes.append('=' * 78)
        partes.append('')
        partes.append(texto)
        partes.append('')
        partes.append('')

    destino = RAIZ / 'CREDITS-LPC.txt'
    destino.write_text('\n'.join(partes), encoding='utf-8', newline='\n')
    print(f'{destino.name}: {len(USADOS) - len(faltando)} pacote(s) creditados, '
          f'{len(destino.read_text(encoding="utf-8").splitlines())} linhas')
    for f in faltando:
        print('  AUSENTE:', f)


if __name__ == '__main__':
    main()
