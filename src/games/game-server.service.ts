import { Injectable, Logger } from '@nestjs/common';
import { Server as HttpServer } from 'http';
import { Server, WebSocketTransport, matchMaker } from 'colyseus';
import { AccessService } from '../access/access.service';
import { ActorService } from '../common/actor.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeducaoRoom } from './deducao/deducao.room';
import { GameTicketsService } from './game-tickets.service';
import { setGameDeps } from './game-deps';

export const DEDUCAO_ROOM = 'deducao';

/// O servidor de jogo mora dentro desta API, no mesmo processo e na mesma porta.
///
/// Quem chama `listen` é o Colyseus, não o Nest: ele sobe o `http.Server` que o
/// Nest já criou em volta do Express, atende sozinho as rotas de matchmaking e
/// devolve todo o resto para o Express. Uma porta só para HTTP e WebSocket, um
/// container só para operar.
@Injectable()
export class GameServerService {
  private readonly logger = new Logger(GameServerService.name);
  private gameServer: Server | null = null;

  constructor(
    private readonly tickets: GameTicketsService,
    private readonly actor: ActorService,
    private readonly access: AccessService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly prisma: PrismaService,
  ) {}

  async listen(httpServer: HttpServer, port: number | string, allowedOrigins: string[]) {
    setGameDeps({
      tickets: this.tickets,
      actor: this.actor,
      access: this.access,
      featureFlags: this.featureFlags,
      prisma: this.prisma,
    });

    // As rotas de matchmaking passam ao lado do pipeline do Nest, então o CORS
    // do `enableCors` não alcança elas. Sem isto o padrão da biblioteca é
    // devolver a origem que pediu, qualquer uma.
    matchMaker.controller.getCorsHeaders = (headers) => {
      const origin = headers.get('origin');
      return { 'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] };
    };

    this.gameServer = new Server({
      transport: new WebSocketTransport({ server: httpServer }),
      greet: false,
    });
    this.gameServer.define(DEDUCAO_ROOM, DeducaoRoom);

    await this.gameServer.listen(port);
    this.logger.log(`Servidor de jogos no ar junto da API, na porta ${port}.`);
    return httpServer;
  }
}
