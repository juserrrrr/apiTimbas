import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Prisma, Side, Position, MatchStatus, MatchType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordServerService } from '../discordServer/discordServer.service';
import { MatchValidator } from './validators/match-validator';
import { CreateCustomLeagueMatchDto } from './dto/create-leagueMatch.dto';
import { UpdateCustomLeagueMatchDto } from './dto/update-leagueMatch.dto';
import { CreateOnlineMatchDto } from './dto/create-online-match.dto';
import { JoinMatchDto } from './dto/join-match.dto';
import { Subject } from 'rxjs';
import { Cron } from '@nestjs/schedule';

export interface MatchEvent {
  type:
    | 'player_joined'
    | 'player_left'
    | 'teams_drawn'
    | 'match_started'
    | 'match_finished'
    | 'match_expired'
    | 'state';
  payload: any;
}

const MATCH_INCLUDE = {
  Teams: {
    include: {
      players: {
        include: { user: { select: { id: true, discordId: true, name: true, avatar: true } } }
      }
    }
  },
  queuePlayers: {
    include: { user: { select: { id: true, discordId: true, name: true, avatar: true } } },
    orderBy: { id: 'asc' as const }
  }
} as const;

@Injectable()
export class LeagueMatchService {
  private readonly logger = new Logger(LeagueMatchService.name);
  private readonly eventSubjects = new Map<number, Subject<MatchEvent>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly discordServerService: DiscordServerService,
  ) {}

  // ─── SSE ─────────────────────────────────────────────────────────────────

  getOrCreateSubject(matchId: number): Subject<MatchEvent> {
    if (!this.eventSubjects.has(matchId)) {
      this.eventSubjects.set(matchId, new Subject<MatchEvent>());
    }
    return this.eventSubjects.get(matchId)!;
  }

  private emit(matchId: number, event: MatchEvent) {
    this.eventSubjects.get(matchId)?.next(event);
  }

  private removeSubject(matchId: number) {
    const sub = this.eventSubjects.get(matchId);
    if (sub) { sub.complete(); this.eventSubjects.delete(matchId); }
  }

  private async findUserByDiscordId(discordId: string) {
    const user = await this.prisma.user.findUnique({ where: { discordId } });
    if (!user) throw new BadRequestException('Usuário não encontrado. Cadastre-se no Timbas primeiro.');
    return user;
  }

  // ─── ONLINE LIFECYCLE ───────────────────────────────────────────────────

  async createOnline(dto: CreateOnlineMatchDto) {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    await this.discordServerService.findOrCreate(dto.discordServerId);
    
    return this.prisma.customLeagueMatch.create({
      data: {
        ServerDiscordId: dto.discordServerId,
        creatorDiscordId: dto.creatorDiscordId,
        matchType: dto.matchFormat || MatchType.ALEATORIO,
        status: MatchStatus.WAITING,
        expiresAt,
      },
      include: MATCH_INCLUDE,
    });
  }

  async findActiveByServer(discordServerId: string) {
    return this.prisma.customLeagueMatch.findMany({
      where: { ServerDiscordId: discordServerId, status: { in: [MatchStatus.WAITING, MatchStatus.STARTED] } },
      include: MATCH_INCLUDE,
      orderBy: { dateCreated: 'desc' },
    });
  }

  async join(matchId: number, dto: JoinMatchDto) {
    const user = await this.findUserByDiscordId(dto.discordId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const match = await tx.customLeagueMatch.findUnique({
        where: { id: matchId },
        include: MATCH_INCLUDE,
      });

      if (!match) throw new NotFoundException('Partida não encontrada.');
      if (match.status !== MatchStatus.WAITING) {
        throw new BadRequestException('A partida já foi iniciada ou encerrada.');
      }
      if (match.queuePlayers.length >= 10) {
        throw new BadRequestException('A partida já está cheia (10/10).');
      }
      if (match.queuePlayers.find((p) => p.userId === user.id)) {
        throw new BadRequestException('Você já está na partida.');
      }

      await tx.userTeamLeague.create({
        data: { matchId: match.id, userId: user.id },
      });

      return tx.customLeagueMatch.findUnique({
        where: { id: matchId },
        include: MATCH_INCLUDE,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    this.emit(matchId, { type: 'player_joined', payload: updated });
    return updated;
  }

  async leave(matchId: number, discordId: string) {
    const match = await this.findOne(matchId);

    if (match.status !== MatchStatus.WAITING) {
      throw new BadRequestException('Não é possível sair de uma partida já iniciada.');
    }

    const user = await this.findUserByDiscordId(discordId);
    const entry = match.queuePlayers.find((p) => p.userId === user.id);
    if (!entry) throw new BadRequestException('Você não está na partida.');

    await this.prisma.userTeamLeague.delete({ where: { id: entry.id } });

    const updated = await this.findOne(matchId);
    this.emit(matchId, { type: 'player_left', payload: updated });
    return updated;
  }

  async draw(matchId: number, requesterDiscordId: string) {
    const match = await this.findOne(matchId);

    if (match.creatorDiscordId !== requesterDiscordId) {
      throw new ForbiddenException('Apenas o criador pode sortear os times.');
    }
    if (match.status !== MatchStatus.WAITING) {
      throw new BadRequestException('Não é possível sortear neste estado da partida.');
    }

    let allPlayers = match.queuePlayers;
    
    // Check if drawn already
    if (match.teamBlueId || match.teamRedId) {
       await this.prisma.userTeamLeague.updateMany({
         where: { matchId },
         data: { teamLeagueId: null, position: null }
       });
       
       const teamsToDelete = [];
       if (match.teamBlueId) teamsToDelete.push(match.teamBlueId);
       if (match.teamRedId) teamsToDelete.push(match.teamRedId);
       
       await this.prisma.customLeagueMatch.update({
         where: { id: matchId },
         data: { teamBlueId: null, teamRedId: null, Teams: { set: [] } }
       });
       
       if (teamsToDelete.length > 0) {
         await this.prisma.teamLeague.deleteMany({
           where: { id: { in: teamsToDelete } }
         });
       }
    }

    if (allPlayers.length < 10) {
      throw new BadRequestException(`São necessários 10 jogadores. Atual: ${allPlayers.length}/10`);
    }

    const shuffled = this.shuffleArray(allPlayers.map((p) => p.id));
    const blueIds = shuffled.slice(0, 5);
    const redIds  = shuffled.slice(5, 10);

    const teamBlue = await this.prisma.teamLeague.create({ data: { side: Side.BLUE } });
    const teamRed = await this.prisma.teamLeague.create({ data: { side: Side.RED } });

    let showDetails = false;

    if (match.matchType === 'ALEATORIO_COMPLETO') {
      const positions: Position[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
      
      const bluePositions = this.shuffleArray([...positions]);
      const redPositions  = this.shuffleArray([...positions]);

      for (let i = 0; i < blueIds.length; i++) {
        await this.prisma.userTeamLeague.update({
          where: { id: blueIds[i] },
          data: { teamLeagueId: teamBlue.id, position: bluePositions[i] },
        });
      }
      for (let i = 0; i < redIds.length; i++) {
        await this.prisma.userTeamLeague.update({
          where: { id: redIds[i] },
          data: { teamLeagueId: teamRed.id, position: redPositions[i] },
        });
      }
      showDetails = true;
    } else {
      await this.prisma.userTeamLeague.updateMany({
        where: { id: { in: blueIds } },
        data: { teamLeagueId: teamBlue.id },
      });
      await this.prisma.userTeamLeague.updateMany({
        where: { id: { in: redIds } },
        data: { teamLeagueId: teamRed.id },
      });
    }

    await this.prisma.customLeagueMatch.update({
      where: { id: matchId },
      data: { 
        showDetails,
        teamBlueId: teamBlue.id,
        teamRedId: teamRed.id,
        Teams: { connect: [{ id: teamBlue.id }, { id: teamRed.id }] }
      },
    });

    const updated = await this.findOne(matchId);
    this.emit(matchId, { type: 'teams_drawn', payload: updated });
    return updated;
  }

  async start(matchId: number, requesterDiscordId: string) {
    const match = await this.findOne(matchId);

    if (match.creatorDiscordId !== requesterDiscordId) {
      throw new ForbiddenException('Apenas o criador pode iniciar a partida.');
    }
    if (match.status !== MatchStatus.WAITING) {
      throw new BadRequestException('A partida já foi iniciada ou encerrada.');
    }

    if (match.queuePlayers.length < 10) {
      throw new BadRequestException(`São necessários 10 jogadores. Atual: ${match.queuePlayers.length}/10`);
    }

    const blueCount = match.Teams.find(t => t.id === match.teamBlueId)?.players?.length || 0;
    const redCount  = match.Teams.find(t => t.id === match.teamRedId)?.players?.length || 0;

    if (match.matchType === 'LIVRE' && (blueCount < 5 || redCount < 5)) {
      // Create teams if missing in LIVRE mode
      const teamBlue = await this.prisma.teamLeague.create({ data: { side: Side.BLUE } });
      const teamRed = await this.prisma.teamLeague.create({ data: { side: Side.RED } });

      const sorted = match.queuePlayers.sort((a, b) => a.id - b.id);
      await this.prisma.userTeamLeague.updateMany({
        where: { id: { in: sorted.slice(0, 5).map((p) => p.id) } },
        data: { teamLeagueId: teamBlue.id },
      });
      await this.prisma.userTeamLeague.updateMany({
        where: { id: { in: sorted.slice(5, 10).map((p) => p.id) } },
        data: { teamLeagueId: teamRed.id },
      });
      await this.prisma.customLeagueMatch.update({
        where: { id: matchId },
        data: { 
          teamBlueId: teamBlue.id,
          teamRedId: teamRed.id,
          Teams: { connect: [{ id: teamBlue.id }, { id: teamRed.id }] }
        },
      });
    } else if (blueCount < 5 || redCount < 5) {
      throw new BadRequestException('Sorteie os times antes de iniciar.');
    }

    const updated = await this.prisma.customLeagueMatch.update({
      where: { id: matchId },
      data: { status: MatchStatus.STARTED, startedAt: new Date() },
      include: MATCH_INCLUDE
    });

    this.emit(matchId, { type: 'match_started', payload: updated });
    return updated;
  }

  async finish(matchId: number, requesterDiscordId: string, winnerSide: Side) {
    const match = await this.findOne(matchId);

    if (match.creatorDiscordId !== requesterDiscordId) {
      throw new ForbiddenException('Apenas o criador pode finalizar a partida.');
    }
    if (match.status !== MatchStatus.STARTED) {
      throw new BadRequestException('A partida não está em andamento.');
    }

    const winnerTeamId = winnerSide === Side.BLUE ? match.teamBlueId : match.teamRedId;

    const updated = await this.prisma.customLeagueMatch.update({
      where: { id: matchId },
      data: {
        status: MatchStatus.FINISHED,
        finishedAt: new Date(),
        winnerId: winnerTeamId,
      },
      include: MATCH_INCLUDE,
    });

    this.emit(matchId, { type: 'match_finished', payload: updated });
    setTimeout(() => this.removeSubject(matchId), 5000);
    return updated;
  }

  @Cron('0 */30 * * * *')
  async cleanExpiredLobbies() {
    this.logger.log('Limpando partidas expiradas online...');
    const toDelete = await this.prisma.customLeagueMatch.findMany({
      where: {
        OR: [
          { status: MatchStatus.EXPIRED },
          {
            status: { in: [MatchStatus.WAITING, MatchStatus.STARTED] },
            expiresAt: { lt: new Date() },
          },
        ],
      },
      select: { id: true, Teams: { select: { id: true } } },
    });

    if (toDelete.length > 0) {
      const matchIds = toDelete.map((m) => m.id);
      const teamIds = toDelete.flatMap((m) => m.Teams.map((t) => t.id));

      for (const match of toDelete) {
        this.emit(match.id, { type: 'match_expired', payload: {} });
      }

      await this.prisma.userTeamLeague.deleteMany({
        where: { matchId: { in: matchIds } },
      });

      if (teamIds.length > 0) {
        await this.prisma.teamLeague.deleteMany({
          where: { id: { in: teamIds } },
        });
      }

      await this.prisma.customLeagueMatch.deleteMany({
        where: { id: { in: matchIds } },
      });

      for (const match of toDelete) {
        setTimeout(() => this.removeSubject(match.id), 2000);
      }

      this.logger.log(`${toDelete.length} partida(s) removida(s) por expiração.`);
    }
  }

  private shuffleArray<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ─── OFFLINE CREATE / GENERIC MATCH ─────────────────────────────────────
  // Mantemos o behavior anterior para partidas criadas no modo offline (via bot).
  
  async create(createLeagueMatchDto: CreateCustomLeagueMatchDto) {
    try {
      if (createLeagueMatchDto.matchType === MatchType.ALEATORIO_COMPLETO) {
        MatchValidator.validateCompleteRandomMatch(createLeagueMatchDto);
      } else {
        MatchValidator.validateNonCompleteRandomMatch(createLeagueMatchDto);
      }

      await this.discordServerService.findOrCreate(createLeagueMatchDto.ServerDiscordId);
      
      return await this.prisma.$transaction(async (prisma) => {
        const mapPlayersToConnect = async (
          players: { userId?: number; discordId?: string; position?: string }[],
        ) => {
          return Promise.all(
            players.map(async (player) => {
              let userId: number;
              if (player.userId) {
                userId = player.userId;
              } else if (player.discordId) {
                const user = await prisma.user.findUnique({ where: { discordId: player.discordId }, select: { id: true } });
                if (!user) throw new NotFoundException(`Usuário com discordId ${player.discordId} não encontrado`);
                userId = user.id;
              } else {
                throw new BadRequestException('Cada jogador deve ter um userId ou discordId.');
              }

              return {
                user: { connect: { id: userId } },
                position: player.position as Position | null,
              };
            }),
          );
        };

        const teamBluePlayersConnect = await mapPlayersToConnect(createLeagueMatchDto.teamBlue.players);
        const teamRedPlayersConnect = await mapPlayersToConnect(createLeagueMatchDto.teamRed.players);

        const teamBlue = await prisma.teamLeague.create({
          data: { side: Side.BLUE, players: { create: teamBluePlayersConnect } },
          include: { players: true },
        });

        const teamRed = await prisma.teamLeague.create({
          data: { side: Side.RED, players: { create: teamRedPlayersConnect } },
          include: { players: true },
        });

        return await prisma.customLeagueMatch.create({
          data: {
            riotMatchId: createLeagueMatchDto.riotMatchId,
            matchType: createLeagueMatchDto.matchType || MatchType.ALEATORIO,
            ServerDiscordId: createLeagueMatchDto.ServerDiscordId,
            teamBlueId: teamBlue.id,
            teamRedId: teamRed.id,
            Teams: { connect: [{ id: teamBlue.id }, { id: teamRed.id }] },
            status: MatchStatus.FINISHED, // Partida offline entra pronta
            creatorDiscordId: null,
            startedAt: new Date(),
            finishedAt: new Date(),
          },
          include: MATCH_INCLUDE,
        });
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new BadRequestException('Já existe uma partida com esses times');
        if (error.code === 'P2003' || error.code === 'P2025') throw new BadRequestException('Jogador não encontrado');
      }
      throw new InternalServerErrorException('Erro ao criar a partida offline');
    }
  }

  async findAll() {
    return await this.prisma.customLeagueMatch.findMany({ include: MATCH_INCLUDE, orderBy: { dateCreated: 'desc' } });
  }

  async findOne(id: number) {
    const match = await this.prisma.customLeagueMatch.findUnique({
      where: { id },
      include: MATCH_INCLUDE,
    });
    if (!match) throw new NotFoundException(`Partida com id ${id} não encontrada`);
    return match;
  }

  async update(id: number, updateLeagueMatchDto: UpdateCustomLeagueMatchDto) {
    return await this.prisma.customLeagueMatch.update({
      where: { id },
      data: {
        winnerId: updateLeagueMatchDto.winnerId ? Number(updateLeagueMatchDto.winnerId) : undefined,
        riotMatchId: updateLeagueMatchDto.riotMatchId,
      },
      include: MATCH_INCLUDE,
    });
  }

  async remove(id: number) {
    const match = await this.findOne(id);
    const teamsToDelete = match.Teams.map((t) => t.id);
    
    await this.prisma.teamLeague.deleteMany({
      where: { id: { in: teamsToDelete } }
    });
    
    return await this.prisma.customLeagueMatch.delete({ where: { id }, include: MATCH_INCLUDE });
  }
}
