# SFU das transmissões (LiveKit no Coolify)

Sem SFU, quem transmite sobe uma cópia do vídeo para cada pessoa que assiste. Com
4 espectadores em 1080p isso passa de 30 Mbit/s de subida e 4 codificações
simultâneas no PC de quem está jogando. Com o SFU, o host sobe **uma** cópia e o
servidor distribui, então a qualidade para de depender do tamanho da sala.

A configuração fica em **/admin/live**, no painel. Preencha URL, chave e
segredo ali e ligue a flag `live_sfu` em **/admin/features**. Só com as duas
coisas as lives passam a usar o servidor; se faltar qualquer uma, o front volta
sozinho para o modo ponto a ponto. É esse o caminho de rollback: desligar a
flag, sem redeploy e sem perder a configuração.

As variáveis `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` continuam
funcionando como fallback, para um deploy que já as usava não quebrar. O que
for salvo no painel tem prioridade sobre elas.

## 1. Gerar as chaves

```bash
openssl rand -hex 32
```

O `LIVEKIT_API_KEY` pode ser qualquer identificador (`timbas` serve). O secret é
o valor gerado acima. As duas precisam ser idênticas nos dois lugares: no
recurso do LiveKit e nas variáveis da API.

## 2. Subir o LiveKit no Coolify

Crie um recurso do tipo **Docker Compose** com o conteúdo de
`docker-compose.livekit.yml` e preencha as variáveis:

| Variável | Valor |
|---|---|
| `LIVEKIT_API_KEY` | `timbas` |
| `LIVEKIT_API_SECRET` | o hex de 32 bytes |
| `LIVEKIT_PUBLIC_IP` | IP público do VPS |
| `LIVEKIT_TURN_DOMAIN` | `livekit.seudominio.com` |

Aponte o domínio `livekit.seudominio.com` para a porta **7880** do container. O
Traefik do Coolify termina o TLS, e o navegador conecta em
`wss://livekit.seudominio.com`.

## 3. Abrir as portas na Contabo

O painel da Contabo tem firewall próprio, e o `ufw` do VPS também precisa
liberar. Sem isso o vídeo simplesmente não flui, mesmo com o WebSocket
conectando.

```bash
ufw allow 7881/tcp   # WebRTC sobre TCP, para rede que bloqueia UDP
ufw allow 7882/udp   # mídia (porta única, via UDP mux)
ufw allow 3478/udp   # TURN embutido
```

## 4. Configurar no painel

Em **/admin/live**, no card Servidor de transmissão:

| Campo | Valor |
|---|---|
| URL do servidor | `wss://livekit.seudominio.com` |
| Chave | `timbas` |
| Segredo | o mesmo hex de 32 bytes |

Salve e clique em **Testar conexão**: o botão faz a API pedir a lista de salas
ao LiveKit, então uma resposta positiva prova que URL, chave e segredo batem.

Depois ligue a flag `live_sfu` em **/admin/features**. Enquanto ela estiver
desligada o card mostra "Configurado, mas desligado" e as lives seguem no modo
ponto a ponto.

## Como conferir se está de pé

- O botão Testar conexão no painel responde com a contagem de salas
- `curl https://livekit.seudominio.com` deve responder `OK`
- Numa live com duas pessoas, a barra de status do estúdio mostra a taxa de
  subida constante mesmo com mais gente entrando. No modo ponto a ponto ela
  multiplicava por espectador
- Se o WebSocket conecta mas a imagem não aparece, o problema é sempre firewall
  de UDP. Confira a 7882/udp nos dois lugares (painel da Contabo e `ufw`)

## Capacidade

O SFU não recodifica nada, só repassa pacotes, então a CPU é irrelevante perto
da banda. O limite real é a velocidade da porta do VPS:

| Porta | Espectadores em 1080p (~6 Mbit/s cada) |
|---|---|
| 200 Mbit/s | ~30 |
| 1 Gbit/s | ~160 |

A franquia de tráfego da Contabo é de 32 TB por mês. Dez pessoas assistindo em
1080p60 consomem cerca de 27 GB por hora, o que dá mais de mil horas de live por
mês dentro da franquia.
