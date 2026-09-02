import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { matchMaker } from 'colyseus';
import { Request } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard, RequirePermissions } from '../access/permission.guard';
import { ActorService } from '../common/actor.service';
import {
  FEATURE_DASHBOARD_GAMES,
  FEATURE_GAME_DEDUCAO,
} from '../feature-flags/feature-flags.constants';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { Role } from '../enums/role.enum';
import { OFFICE_MAP } from './deducao/map';
import { DEFAULT_CONFIG, MAX_PLAYERS, MIN_PLAYERS } from './deducao/rules';
import { DEDUCAO_ROOM } from './game-server.service';
import { GameTicketsService } from './game-tickets.service';

type AuthedRequest = Request & { tokenPayload?: { discordId?: string } };

@UseGuards(AuthGuard, PermissionGuard)
@RequirePermissions('dashboard.games')
@Controller('games')
export class GamesController {
  constructor(
    private readonly featureFlags: FeatureFlagsService,
    private readonly actor: ActorService,
    private readonly tickets: GameTicketsService,
  ) {}

  @Post('deducao/ticket')
  async ticket(@Req() req: AuthedRequest) {
    const person = await this.requireDeducaoAccess(req);
    return { ticket: this.tickets.issue(person.discordId) };
  }

  @Get()
  async catalog(@Req() req: AuthedRequest) {
    const person = await this.actor.require(req.tokenPayload?.discordId);
    const isAdmin = person.role === Role.ADMIN;
    const [hub, deducao] = await Promise.all([
      this.featureFlags.isEnabled(FEATURE_DASHBOARD_GAMES),
      this.featureFlags.isEnabled(FEATURE_GAME_DEDUCAO),
    ]);

    const games = isAdmin || (hub && deducao)
      ? [
          {
            id: DEDUCAO_ROOM,
            name: 'Timbas Detetive',
            tagline: 'Jogo de dedução',
            description:
              'Descubra os assassinos antes que eles eliminem o grupo, ou conclua todas as tarefas para vencer.',
            players: `${MIN_PLAYERS} a ${MAX_PLAYERS} jogadores`,
            minutes: '10 a 20 min',
            href: '/games/deducao',
          },
        ]
      : [];

    return { games };
  }

  /// As salas abertas. A listagem sai por aqui, e não pelo matchmaking do
  /// Colyseus, porque a 0.18 tirou essa rota e porque assim a lista respeita a
  /// mesma permissão do resto da área. O filtro `private` do Colyseus não serve
  /// aqui: toda sala aberta por `create` nasce marcada assim, e o que decide se
  /// ela tem senha é a nossa própria metadata.
  @Get('deducao/rooms')
  async rooms(@Req() req: AuthedRequest) {
    await this.requireDeducaoAccess(req);
    const rooms = await matchMaker.query({ name: DEDUCAO_ROOM });
    return rooms.map((room) => {
      const meta = (room.metadata ?? {}) as Record<string, unknown>;
      return {
        roomId: room.roomId,
        name: String(meta.name ?? 'Sala do Timbas'),
        code: String(meta.code ?? ''),
        host: String(meta.host ?? ''),
        phase: String(meta.phase ?? 'lobby'),
        private: Boolean(meta.private),
        players: Number(meta.players ?? room.clients ?? 0),
        maxPlayers: Number(meta.maxPlayers ?? room.maxClients ?? 12),
        locked: Boolean(room.locked),
      };
    });
  }

  /// O mapa vem daqui em vez de estar copiado no front: as paredes que o
  /// servidor usa para colisão têm que ser exatamente as que a tela desenha.
  @Get('deducao/map')
  async map(@Req() req: AuthedRequest) {
    await this.requireDeducaoAccess(req);
    return { map: OFFICE_MAP, config: DEFAULT_CONFIG, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS };
  }

  private async requireDeducaoAccess(req: AuthedRequest) {
    const person = await this.actor.require(req.tokenPayload?.discordId);
    await this.featureFlags.ensureEnabledOrAdmin(FEATURE_DASHBOARD_GAMES, person.role);
    await this.featureFlags.ensureEnabledOrAdmin(FEATURE_GAME_DEDUCAO, person.role);
    return person;
  }
}
