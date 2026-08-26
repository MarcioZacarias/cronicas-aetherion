# Como montar os prédios no Tiled

O jogo precisa de **imagens de prédio prontas** — um PNG por prédio, com
fundo transparente. Os pacotes LPC entregam *peças* para montagem manual,
e é por isso que montar por código não deu certo: as bordas dos telhados
são tacaniças desenhadas para um canto específico, e os recortes fixos vêm
com pedaços das peças vizinhas.

Montar à mão uma vez resolve de vez. São uns 40 minutos para 6–8 prédios.

---

## 1. Instalar o Tiled

<https://www.mapeditor.org> — é gratuito e de código aberto. Instale a
versão para Windows.

## 2. Abrir o projeto

Abra o arquivo **`predio-modelo.tmx`** desta pasta. Ele já vem com:

- um mapa de 16×16 tiles (espaço de sobra para um prédio)
- os três tilesets carregados: `roofs`, `bricks` e `windows-doors`
- três camadas, na ordem certa de desenho:

| Camada | O que vai nela |
|---|---|
| `parede` | o tijolo do térreo (tileset **bricks**) |
| `telhado` | o telhado (tileset **roofs**) |
| `portas-janelas` | porta e janelas (tileset **windows-doors**) |

As camadas já estão empilhadas na ordem correta: parede embaixo, telhado
por cima, aberturas por último.

## 3. Desenhar um prédio

1. Selecione a camada **parede** no painel direito.
2. No painel de tilesets (embaixo), escolha **bricks** e pinte um retângulo
   de 2 tiles de altura pela largura que quiser — 4 a 8 tiles funciona bem.
3. Selecione a camada **telhado**, escolha **roofs** e desenhe o telhado
   **acima** da parede, deixando o beiral **avançar 1 tile para cada lado**.
   É esse avanço que dá silhueta ao prédio; sem ele fica um retângulo.
4. Selecione **portas-janelas**, escolha **windows-doors** e ponha uma porta
   (2 tiles de altura) e as janelas sobre a parede.

**Dica:** os telhados ficam nas primeiras linhas do tileset `roofs`. Cada
cor tem um conjunto completo com cumeeira, águas e tacaniças — use as peças
de canto nas quinas, senão fica serrilhado.

## 4. Exportar

`Arquivo` → `Exportar como imagem…`

Marque:
- ✅ **Somente camadas visíveis**
- ❌ **Incluir cor de fundo** (precisa ficar DESmarcado, para o PNG sair com
  fundo transparente)
- ❌ Desenhar grade de tiles

Salve em: **`public/assets/predios/`**

## 5. Nome do arquivo — importante

O nome carrega o tamanho do prédio em tiles, para o jogo saber o espaço que
ele ocupa:

```
<nome>-<largura>x<altura>.png
```

Exemplos:

```
casa-vermelha-6x5.png
casa-azul-5x5.png
sobrado-verde-7x6.png
armaria-6x5.png
templo-8x7.png
taverna-6x5.png
```

Meça **contando os tiles do prédio inteiro**, incluindo o beiral que
avança. Se o telhado avança 1 tile para cada lado de uma parede de 5, a
largura é 7.

## 6. Me avise

Quando tiver 6–8 prédios exportados, é só falar. Eu ligo no gerador de mapa
e a cidade passa a usá-los — não preciso de mais nada além dos arquivos.

---

## Se travar em algo

- **O tileset não aparece:** o `.tsx` e o `.png` precisam estar na mesma
  pasta que o `.tmx`. Estão, se você não moveu nada.
- **O PNG saiu com fundo:** desmarque "Incluir cor de fundo" na exportação.
- **Não sei qual telhado usar:** abra `roofs.png` numa visualização de
  imagem. As primeiras linhas têm telhados inclinados em várias cores; as
  linhas do meio têm telha escamada. Qualquer uma serve, desde que você use
  o conjunto inteiro da mesma cor.

## Créditos

Os `CREDITS-*.txt` desta pasta são obrigatórios: a arte é CC-BY-SA e exige
atribuir todos os autores originais. Eles já estão consolidados em
`CREDITS-LPC.txt` na raiz do projeto.
