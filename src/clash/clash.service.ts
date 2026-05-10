import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { RiotService } from '../riot/riot.service';
import { AiService, FullPlayerData, AiAnalysis } from '../ai/ai.service';
import { PlayerStatsService } from '../playerStats/player-stats.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClashService {
  private readonly logger = new Logger(ClashService.name);

  constructor(
    private readonly riotService: RiotService,
    private readonly aiService: AiService,
    private readonly playerStatsService: PlayerStatsService,
    private readonly prisma: PrismaService,
  ) {}

  async scout(gameName: string, tagLine: string) {
    const account = await this.riotService.getAccount(gameName, tagLine);
    const clashPlayers = await this.riotService.getClashPlayersByPuuid(account.puuid);
    if (!clashPlayers.length) {
      throw new BadRequestException(`${gameName}#${tagLine} não está registrado em nenhum time de Clash ativo.`);
    }

    const team = await this.riotService.getClashTeam(clashPlayers[0].teamId);
    const championMap = await this.riotService.getChampionIdNameMap();

    const players: FullPlayerData[] = [];

    for (const member of team.players as { puuid: string; position: string }[]) {
      try {
        players.push(await this.playerStatsService.buildFromPuuid(member.puuid, championMap, member.position));
      } catch (err) {
        this.logger.warn(`Falha ao processar ${member.puuid}: ${(err as any)?.message}`);
      }
    }

    let analysis: AiAnalysis = { bans: [], counterplays: [], predictedPicks: [], strategy: '' };
    try {
      analysis = await this.aiService.analyzeOpponents(players);
    } catch (err) {
      this.logger.warn('Falha na análise de IA', err);
    }

    return {
      team: {
        id: team.id,
        name: team.name ?? 'Time sem nome',
        abbreviation: team.abbreviation ?? '???',
        iconId: team.iconId ?? 0,
        tier: team.tier ?? 0,
      },
      players,
      bans: analysis.bans,
      counterplays: analysis.counterplays,
      predictedPicks: analysis.predictedPicks,
      strategy: analysis.strategy,
    };
  }

  async saveAnalysis(data: any): Promise<{ id: string }> {
    const record = await this.prisma.clashAnalysis.create({
      data: {
        teamName: data.team?.name ?? 'Desconhecido',
        data,
      },
    });
    return { id: record.id };
  }

  async getAnalysis(id: string): Promise<{ data: any; teamName: string; createdAt: Date }> {
    const record = await this.prisma.clashAnalysis.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Análise não encontrada');
    return { data: record.data, teamName: record.teamName, createdAt: record.createdAt };
  }
}
