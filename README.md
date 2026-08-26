# Crônicas de Aetherion

Protótipo jogável de MMORPG 2D top-down inspirado em Tibia, desenvolvido em HTML5/Canvas puro — **arquivo único, sem dependências, roda em qualquer navegador** (desktop e mobile).

🎮 **Jogar:** <https://srv1927329.hstgr.cloud> — ou abra o `index.html` localmente no navegador.

## Conteúdo atual

- **Capítulo I — Sombras em Aurora:** Vila de Lumera, Minas de Aurora, boss Gormak, o mistério da porta do Eclipse e o primeiro Fragmento do Abismo
- **Capítulo II — O Símbolo Negro:** travessia de navio para Valedorn, capital Ardentia, investigação da Irmandade da Nova Aurora, Catacumbas e o Alto Sacerdote Corvus
- Click-to-move com pathfinding, diálogos por palavras-chave, lojas, estalagem, livros de lore, segredos escondidos, sistema de quest, inventário/equipamentos, magia em área, escuridão com tochas

## Controles

| Ação | Como |
|---|---|
| Mover | Toque no destino (pathfinding) ou setas/WASD/direcional |
| Atacar | Toque no monstro (persegue e ataca sozinho) ou ⚔️ |
| Magia Exori | Botão 🔥 ou tecla E (20 MP, dano em área) |
| Mochila | Botão 🎒 ou tecla B |
| Interagir | Toque em NPCs, baús, placas, livros, portas, barco |

## Stack

HTML5 Canvas + JavaScript vanilla. Sprites embutidos em base64 (arquivo único e portátil). Sem build, sem framework, sem servidor — por enquanto. 😉

## Roadmap

- [ ] Save game (localStorage)
- [ ] Capítulo III — Os Sete
- [ ] Sistema de vocações (Cavaleiro, Mago, Arqueiro, Sacerdote)
- [ ] Multiplayer via WebSocket (Node.js)

## Deploy

Hospedado em VPS Debian 13 + nginx, servido como site estático em <https://srv1927329.hstgr.cloud>
(HTTPS via Let'''s Encrypt, renovação automática pelo `certbot.timer`).

O diretório `/var/www/aetherion` é um clone deste repositório, autenticado por uma
**deploy key read-only** — o servidor lê o repositório, nunca escreve nele.

Para publicar uma alteração:

```bash
git push                                    # da máquina local
ssh root@srv1927329.hstgr.cloud deploy-aetherion   # no servidor
```

O `deploy-aetherion` faz `fetch` + `reset --hard origin/main`, normaliza permissões e
mostra o commit que ficou no ar. O `index.html` é servido com `Cache-Control: no-cache`,
então cada deploy chega ao jogador imediatamente.

## Créditos e licença dos assets

Arte: **Liberated Pixel Cup (LPC) Base Assets** — autores listados em [`CREDITS-LPC.txt`](CREDITS-LPC.txt), incluindo Lanea Zimmerman (Sharm), entre outros. Licenças: **CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0** (conforme o autor).

Este projeto redistribui os sprites (embutidos em base64 no HTML) sob os termos dessas licenças; a atribuição integral está preservada em `CREDITS-LPC.txt`.

Código do jogo: MIT — use como quiser, mantendo os créditos dos assets.
