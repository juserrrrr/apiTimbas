import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, Side, Position, MatchStatus, MatchType } from '@prisma/client';
import { ChannelType, Client, TextChannel, VoiceChannel } from 'discord.js';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordServerService } from '../discordServer/discordServer.service';
import { MatchValidator } from './validators/match-validator';
import { CreateCustomLeagueMatchDto } from './dto/create-leagueMatch.dto';
import { UpdateCustomLeagueMatchDto } from './dto/update-leagueMatch.dto';
import { CreateOnlineMatchDto } from './dto/create-online-match.dto';
import { JoinMatchDto } from './dto/join-match.dto';
import { Subject } from 'rxjs';
import { Cron } from '@nestjs/schedule';
import { buildMatchEmbed, MATCH_TYPE_LABELS } from '../discord/helpers/embed.helper';
import { buildOnlineLobbyButtons } from '../discord/helpers/match-buttons.helper';
import * as path from 'path';
import * as fs from 'fs';

export interface VoiceStatusPayload {
  discordId: string;
  channelId: string | null;
  channelName: string | null;
  channelType: 'WAITING' | 'BLUE' | 'RED' | 'OTHER' | null;
}

export interface MatchEvent {
  type:
    | 'player_joined'
    | 'player_left'
    | 'teams_drawn'
    | 'match_started'
    | 'match_finished'
    | 'match_expired'
    | 'voice_status'
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
  private readonly sseTickets = new Map<string, { matchId: number; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly discordServerService: DiscordServerService,
    private readonly client: Client,
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

  emitVoiceStatus(matchId: number, payload: VoiceStatusPayload): void {
    this.emit(matchId, { type: 'voice_status', payload });
  }

  async findActiveMatchIdForUser(guildId: string, discordId: string): Promise<number | null> {
    const match = await this.prisma.customLeagueMatch.findFirst({
      where: {
        ServerDiscordId: guildId,
        status: { in: ['WAITING', 'STARTED'] },
        OR: [
          { queuePlayers: { some: { user: { discordId } } } },
          { Teams: { some: { players: { some: { user: { discordId } } } } } },
        ],
      },
      select: { id: true },
    });
    return match?.id ?? null;
  }

  createSseTicket(matchId: number): string {
    const ticket = randomUUID();
    this.sseTickets.set(ticket, { matchId, expiresAt: Date.now() + 30_000 });
    return ticket;
  }

  validateAndConsumeSseTicket(ticket: string, matchId: number): boolean {
    const entry = this.sseTickets.get(ticket);
    this.sseTickets.delete(ticket);
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) return false;
    if (entry.matchId !== matchId) return false;
    return true;
  }

  private async findUserByDiscordId(discordId: string) {
    const user = await this.prisma.user.findUnique({ where: { discordId } });
    if (!user) throw new BadRequestException('Usuário não encontrado. Cadastre-se no Timbas primeiro.');
    return user;
  }

  // ─── DISCORD EMBED ANNOUNCEMENT ──────────────────────────────────────────

  async announceMatchToGuild(matchId: number, guildId: string, matchFormat: MatchType | undefined, playersPerTeam: number): Promise<void> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;

    const textChannel = guild.channels.cache.find(
      c => c.type === ChannelType.GuildText && c.name === 'custom_game'
    ) as TextChannel | undefined;
    if (!textChannel) return;

    const webUrl = `${process.env.WEB_URL ?? 'http://localhost:3000'}/dashboard/match/${matchId}`;
    const formatName = MATCH_TYPE_LABELS[matchFormat ?? 'ALEATORIO'] ?? 'Aleatório';
    const maxPlayers = playersPerTeam * 2;

    const gifPath = path.join(process.cwd(), 'images', 'timbasQueueGif.gif');
    const hasGif = fs.existsSync(gifPath);
    const files = hasGif ? [{ attachment: gifPath, name: 'timbas.gif' }] : [];

    const embed = buildMatchEmbed([], [], formatName, 'Online', `Aguardando jogadores... 0/${maxPlayers}`, webUrl, null, false, hasGif, playersPerTeam);
    const buttons = buildOnlineLobbyButtons(matchId, false, false, matchFormat === 'LIVRE');

    try {
      const message = await textChannel.send({ embeds: [embed], components: buttons, files });
      this.subscribeToMatchEmbed(matchId, message, matchFormat, playersPerTeam);
    } catch (e) {
      this.logger.error(`Failed to announce match ${matchId} to guild ${guildId}: ${e}`);
    }
  }

  private subscribeToMatchEmbed(matchId: number, message: any, matchFormat: MatchType | undefined, playersPerTeam: number) {
    const subject = this.getOrCreateSubject(matchId);
    let finished = false;

    const subscription = subject.subscribe({
      next: async (event: any) => {
        if (finished) return;
        const { type, payload } = event;

        if (['player_joined', 'player_left', 'teams_drawn', 'match_started', 'match_finished', 'state'].includes(type)) {
          await this.updateMatchEmbed(message, payload, matchFormat, playersPerTeam);
        }

        if (type === 'match_expired') {
          finished = true;
          subscription.unsubscribe();
          setTimeout(() => message.delete().catch(() => {}), 5000);
          return;
        }

        if (type === 'match_finished' || payload?.status === 'FINISHED') {
          finished = true;
          subscription.unsubscribe();
        }
      },
      complete: () => { subscription.unsubscribe(); },
    });
  }

  private async updateMatchEmbed(message: any, lobby: any, matchFormat: MatchType | undefined, playersPerTeam: number) {
    const status = lobby?.status ?? 'WAITING';
    const players = lobby?.queuePlayers ?? [];
    const teams = lobby?.Teams ?? [];
    const blueId = lobby?.teamBlueId;
    const redId = lobby?.teamRedId;
    const half = playersPerTeam;
    const maxPlayers = playersPerTeam * 2;

    let blueTeam: any[] = [];
    let redTeam: any[] = [];
    for (const t of teams) {
      if (t.id === blueId) blueTeam = t.players ?? [];
      else if (t.id === redId) redTeam = t.players ?? [];
    }

    const showDetails = blueTeam.length > 0 || redTeam.length > 0;
    const blueDisplay = showDetails ? blueTeam : players.slice(0, half);
    const redDisplay = showDetails ? redTeam : players.slice(half, maxPlayers);

    let winner: 'BLUE' | 'RED' | null = null;
    if (status === 'FINISHED') {
      winner = lobby.winnerId === blueId ? 'BLUE' : 'RED';
    }

    const footerMap: Record<string, string> = {
      WAITING: `Aguardando jogadores... ${players.length}/${maxPlayers}`,
      STARTED: 'Partida em andamento! 🎮',
      FINISHED: 'Partida finalizada! 🏁',
      EXPIRED: 'Partida expirada.',
    };

    const started = status === 'STARTED';
    const finished = status === 'FINISHED' || status === 'EXPIRED';
    const webUrl = (!winner && !finished)
      ? `${process.env.WEB_URL ?? 'http://localhost:3000'}/dashboard/match/${lobby.id}`
      : undefined;
    const gifAttachment = message.attachments?.find((a: any) => a.name === 'timbas.gif' || a.name === 'timbasQueueGif.gif');
    const gifUrl = gifAttachment ? gifAttachment.url : false;
    const formatName = MATCH_TYPE_LABELS[matchFormat ?? 'ALEATORIO'] ?? 'Aleatório';
    const embed = buildMatchEmbed(blueDisplay, redDisplay, formatName, 'Online', footerMap[status] ?? '', webUrl, winner, showDetails, gifUrl, playersPerTeam);
    const buttons = buildOnlineLobbyButtons(lobby.id, started, finished, matchFormat === 'LIVRE');

    try {
      await message.edit({ embeds: [embed], components: buttons });
    } catch {}
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
        playersPerTeam: dto.playersPerTeam ?? 5,
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

      const maxPlayers = match.playersPerTeam * 2;
      if (match.queuePlayers.length >= maxPlayers) {
        throw new BadRequestException(`A partida já está cheia (${maxPlayers}/${maxPlayers}).`);
      }
      if (match.queuePlayers.find((p) => p.userId === user.id)) {
        throw new BadRequestException('Você já está na partida.');
      }

      // Voice Channel Validation
      if (match.ServerDiscordId && user.discordId) {
        const guild = this.client.guilds.cache.get(match.ServerDiscordId);
        if (guild) {
          let member = guild.members.cache.get(user.discordId);
          if (!member) {
            try { member = await guild.members.fetch(user.discordId); } catch {}
          }
          const channel = (member as any)?.voice?.channel as VoiceChannel | null;

          const waitingChannel = guild.channels.cache.find(
            (c) => c.type === 2 && c.name === '| 🕘 | AGUARDANDO'
          ) as VoiceChannel | undefined;

          if (channel && waitingChannel && channel.id !== waitingChannel.id) {
            await (member as any)?.voice?.setChannel(waitingChannel).catch(() => {});
          }
        }
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

    const allPlayers = match.queuePlayers;
    const playersPerTeam = match.playersPerTeam;
    const maxPlayers = playersPerTeam * 2;

    // Clean up previous draw if exists
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
        await this.prisma.teamLeague.deleteMany({ where: { id: { in: teamsToDelete } } });
      }
    }

    if (allPlayers.length < maxPlayers) {
      throw new BadRequestException(`São necessários ${maxPlayers} jogadores. Atual: ${allPlayers.length}/${maxPlayers}`);
    }

    const shuffled = this.shuffleArray(allPlayers.map((p) => p.id));
    const blueIds = shuffled.slice(0, playersPerTeam);
    const redIds  = shuffled.slice(playersPerTeam, maxPlayers);

    const teamBlue = await this.prisma.teamLeague.create({ data: { side: Side.BLUE } });
    const teamRed = await this.prisma.teamLeague.create({ data: { side: Side.RED } });

    let showDetails = false;

    if (match.matchType === 'ALEATORIO_COMPLETO' && playersPerTeam === 5) {
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

    const playersPerTeam = match.playersPerTeam;
    const maxPlayers = playersPerTeam * 2;

    if (match.queuePlayers.length < maxPlayers) {
      throw new BadRequestException(`São necessários ${maxPlayers} jogadores. Atual: ${match.queuePlayers.length}/${maxPlayers}`);
    }

    const blueCount = match.Teams.find(t => t.id === match.teamBlueId)?.players?.length || 0;
    const redCount  = match.Teams.find(t => t.id === match.teamRedId)?.players?.length || 0;

    if (match.matchType === 'LIVRE' && (blueCount < playersPerTeam || redCount < playersPerTeam)) {
      const teamBlue = await this.prisma.teamLeague.create({ data: { side: Side.BLUE } });
      const teamRed = await this.prisma.teamLeague.create({ data: { side: Side.RED } });

      const sorted = match.queuePlayers.sort((a, b) => a.id - b.id);
      await this.prisma.userTeamLeague.updateMany({
        where: { id: { in: sorted.slice(0, playersPerTeam).map((p) => p.id) } },
        data: { teamLeagueId: teamBlue.id },
      });
      await this.prisma.userTeamLeague.updateMany({
        where: { id: { in: sorted.slice(playersPerTeam, maxPlayers).map((p) => p.id) } },
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
    } else if (blueCount < playersPerTeam || redCount < playersPerTeam) {
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

  async moveToRoom(matchId: number, discordId: string) {
    const match = await this.findOne(matchId);
    if (!match.ServerDiscordId) {
      throw new BadRequestException('Partida não vinculada a um servidor do Discord.');
    }
    if (match.status !== MatchStatus.STARTED) {
      throw new BadRequestException('A partida não está em andamento.');
    }

    const guild = this.client.guilds.cache.get(match.ServerDiscordId);
    if (!guild) {
      throw new BadRequestException('Servidor do Discord não encontrado.');
    }

    let member = guild.members.cache.get(discordId);
    if (!member) {
      try { member = await guild.members.fetch(discordId); } catch {}
    }
    if (!member) {
      throw new BadRequestException('Membro não encontrado no Discord.');
    }

    const channel = (member as any)?.voice?.channel as VoiceChannel | null;
    if (!channel) {
      throw new BadRequestException('Você precisa estar conectado a algum canal de voz no servidor para ser movido.');
    }

    const isBlue = match.Teams.find(t => t.id === match.teamBlueId)?.players?.some(p => p.user?.discordId === discordId);
    const isRed = match.Teams.find(t => t.id === match.teamRedId)?.players?.some(p => p.user?.discordId === discordId);

    let targetChannelName = '';
    if (isBlue) targetChannelName = 'LADO [ |🔵| ]';
    else if (isRed) targetChannelName = 'LADO [ |🔴| ]';
    else throw new BadRequestException('Você não está em nenhum time nesta partida.');

    const targetChannel = guild.channels.cache.find(c => c.type === 2 && c.name === targetChannelName) as VoiceChannel | undefined;
    if (!targetChannel) {
      throw new BadRequestException(`Canal de voz do seu time (${targetChannelName}) não encontrado.`);
    }

    if (channel.id !== targetChannel.id) {
      await (member as any)?.voice?.setChannel(targetChannel).catch(() => {
        throw new BadRequestException('Erro ao mover você para o canal do time. Verifique suas permissões.');
      });
    }

    return { success: true, message: 'Movido com sucesso.' };
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
      data: { status: MatchStatus.FINISHED, finishedAt: new Date(), winnerId: winnerTeamId },
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
          { status: { in: [MatchStatus.WAITING, MatchStatus.STARTED] }, expiresAt: { lt: new Date() } },
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

      await this.prisma.userTeamLeague.deleteMany({ where: { matchId: { in: matchIds } } });

      if (teamIds.length > 0) {
        await this.prisma.teamLeague.deleteMany({ where: { id: { in: teamIds } } });
      }

      await this.prisma.customLeagueMatch.deleteMany({ where: { id: { in: matchIds } } });

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

  // ─── OFFLINE CREATE ───────────────────────────────────────────────────────

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

        const playersPerTeam = createLeagueMatchDto.teamBlue.players.length;

        return await prisma.customLeagueMatch.create({
          data: {
            riotMatchId: createLeagueMatchDto.riotMatchId,
            matchType: createLeagueMatchDto.matchType || MatchType.ALEATORIO,
            playersPerTeam,
            ServerDiscordId: createLeagueMatchDto.ServerDiscordId,
            teamBlueId: teamBlue.id,
            teamRedId: teamRed.id,
            Teams: { connect: [{ id: teamBlue.id }, { id: teamRed.id }] },
            status: MatchStatus.FINISHED,
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

    await this.prisma.teamLeague.deleteMany({ where: { id: { in: teamsToDelete } } });

    return await this.prisma.customLeagueMatch.delete({ where: { id }, include: MATCH_INCLUDE });
  }
}
