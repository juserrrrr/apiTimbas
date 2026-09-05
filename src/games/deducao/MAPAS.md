# Mapas locais do Timbas Detetive

O mapa jogável não é criado nem salvo pelo painel administrativo. A fase, as colisões, as tarefas, os dutos e os pontos de entrada ficam versionados com o jogo.

## Mapa principal

- Definição: `map.ts`, constante `OFFICE_MAP`
- Catálogo: `maps.ts`, constante `LOCAL_GAME_MAPS`
- Unidade: 1 unidade equivale a 1 metro
- Eixos: `x` aponta para leste e `z` para sul
- Modelos e materiais 3D: repositório `timbas-web`, em `public/models/games/deducao` e `public/images/games/deducao`

Para ajustar o mapa, altere a definição local, rode os testes de `movement.spec.ts` e abra uma sala no ambiente local. O cliente baixa exatamente a mesma definição usada pelo servidor para colisão.

## Sala de espera

`lobby-map.ts` define `LOBBY_MAP`, uma sala de 12 × 10 metros centrada na origem, sem tarefas ou escadas. Os endpoints de mapa entregam essa definição no campo `lobby`, junto do mapa da partida no campo `map`. O lobby não aparece como mapa selecionável.

Na fase `lobby`, o movimento usa suas paredes e móveis. Ao começar a partida, todos vão para os pontos de entrada do escritório; reiniciar leva todos aos 12 pontos centrais do lobby. As medidas dos móveis acompanham o modelo Blender da sala de espera.

## Mapas futuros

Crie outra definição `GameMap` e registre-a em `LOCAL_GAME_MAPS` com um id permanente. O seletor de mapa das salas usa esse catálogo automaticamente.
