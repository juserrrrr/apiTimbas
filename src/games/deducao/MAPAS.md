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

## Tarefas e distribuição

O escritório contém 55 pontos nos 21 ambientes, preservando os 15 identificadores anteriores. Nenhum ponto foi colocado no lobby ou sobre a escada.

| Quantidade por ambiente | Ambientes |
| --- | --- |
| 3 | Servidores, open space, reunião, recepção, copa, apoio, depósito, arquivo, operações, chefe, lounge, terraço e conselho |
| 2 | Banheiro, átrio, mezanino e os cinco corredores |

Cada ambiente tem ao menos dois tipos distintos dentre os sete minigames existentes: rack, arquivo, senha, café, cabos, impressora e estoque. Os pontos ficam em áreas acessíveis junto a móveis ou painéis, sem acrescentar móveis pesados ao mapa. `map.spec.ts` percorre a malha dos dois pisos com o raio real de 0,45 m e chega a todos os pontos sem atravessar colisões.

`duration` pode ser `curta`, `media` ou `longa`; ausência mantém `curta` para catálogos anteriores. O catálogo atual distribui 21 curtas, 21 médias e 13 longas. Os mínimos de conclusão no servidor são 1.200, 3.500 e 6.500 ms, respectivamente; a interface adapta as etapas do minigame, não somente um contador.

O sorteio continua aleatório e respeita a quantidade configurada. Distribui uma tarefa por jogador a cada rodada, evitando salas já visitadas na lista individual, pontos muito compartilhados e salas muito usadas. Prefere tipos/durações diferentes e destinos distantes dos demais destinos daquela rodada e das tarefas da própria pessoa. A diferença de piso recebe peso espacial de 8 m; é uma heurística de dispersão, não um cálculo de caminho mínimo pelas escadas. A lista sugere destinos, mas o servidor aceita qualquer tarefa atribuída, em qualquer ordem.

Em cem sementes determinísticas para 4, 8 e 12 jogadores com quatro tarefas cada, os testes exigem primeiras salas distintas, distância mínima inicial média ao menos 50% maior que no sorteio independente anterior e menos de um quarto da sobreposição de pontos anterior. Com até oito tarefas por pessoa e muitos jogadores, compartilhar alguns pontos é inevitável.

## Confirmação de tarefas

- Cliente envia `task:begin` e `task:done` com `spotId` e um `requestId` opcional, string não vazia de até 100 caracteres por abertura. O servidor ecoa o identificador válido em todas as respostas.
- `task:ok` inclui `spotId`, `kind`, `label`, `duration` e `minDurationMs`. Repetir a mesma abertura identificada não reinicia o tempo.
- `task:completed` inclui `spotId` e é enviado antes de eventual fim da partida. Repetição de uma conclusão já aceita não conta duas vezes.
- `task:rejected` inclui `spotId`, `reason` em português e, quando faltou tempo, `retryAfterMs`. O tempo restante não cancela a abertura atual.

A tarefa precisa ser da pessoa, a conexão precisa estar ativa e não pode estar em um duto. Pessoas vivas precisam manter mesmo piso, alcance de 2,2 m e linha de visão livre. Fantasmas preservam a conclusão remota de uma tarefa aberta. Pacotes de uma abertura antiga não concluem uma abertura nova. A validação de tempo e localização não prova, por si só, que um cliente modificado resolveu o minigame.

## Perícia do detetive

`forensic:inspect {corpseId}` examina um corpo ainda não reportado. Exige detetive vivo, conectado, fora do duto, durante a partida, no mesmo piso, a até 2,6 m e com linha de visão. Uma leitura por corpo e recarga pessoal de 30 segundos, cobrada somente no sucesso.

A resposta privada `forensic:result {corpseId,ageBand,blackout}` informa somente idade aproximada (`recente`: menos de 15 s; `intermediario`: de 15 s até menos de 45 s; `antigo`: 45 s ou mais) e se a morte ocorreu durante apagão. Não informa identidade, cor ou papel de quem matou. Horário exato e estado de luz na morte ficam somente no servidor, fora do estado replicado.

`forensic:status` devolve `readyAt`, `serverNow`, `cooldownMs` e `inspectedCorpseIds`, exclusivamente ao detetive. É enviado no início, na reconexão, na consulta e após uma tentativa. `forensic:rejected {reason}` explica recusas sem gastar recarga. Uma nova partida ou o retorno ao lobby limpa as perícias. A investigação de alguém durante a reunião continua existindo e entrega sua leitura privada somente na reunião seguinte.
