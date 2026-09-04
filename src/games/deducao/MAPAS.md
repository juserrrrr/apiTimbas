# Mapas locais do Timbas Detetive

O mapa jogável não é criado nem salvo pelo painel administrativo. A fase, as colisões, as tarefas, os dutos e os pontos de entrada ficam versionados com o jogo.

## Mapa principal

- Definição: `map.ts`, constante `OFFICE_MAP`
- Catálogo: `maps.ts`, constante `LOCAL_GAME_MAPS`
- Unidade: 1 unidade equivale a 1 metro
- Eixos: `x` aponta para leste e `z` para sul
- Modelos e materiais 3D: repositório `timbas-web`, em `public/models/games/deducao` e `public/images/games/deducao`

Para ajustar o mapa, altere a definição local, rode os testes de `movement.spec.ts` e abra uma sala no ambiente local. O cliente baixa exatamente a mesma definição usada pelo servidor para colisão.

## Mapas futuros

Crie outra definição `GameMap` e registre-a em `LOCAL_GAME_MAPS` com um id permanente. O seletor de mapa das salas usa esse catálogo automaticamente.
