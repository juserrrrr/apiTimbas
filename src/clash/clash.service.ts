import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { RiotService } from '../riot/riot.service';
import { AiService, FullPlayerData, AiAnalysis } from '../ai/ai.service';
import { PlayerStatsService } from '../playerStats/player-stats.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ScoutProgress {
  stage: string;
  message: string;
  percent: number;
  current?: number;
  total?: number;
}

export type ScoutProgressFn = (progress: ScoutProgress) => void;

@Injectable()
export class ClashService {
  private readonly logger = new Logger(ClashService.name);

  constructor(
    private readonly riotService: RiotService,
    private readonly aiService: AiService,
    private readonly playerStatsService: PlayerStatsService,
    private readonly prisma: PrismaService,
  ) {}

  // deep=true ativa a análise de timeline (mapa de gank/mortes/invades) —
  // custa ~8 requisições extras por jogador, então é opt-in.
  async scout(gameName: string, tagLine: string, onProgress?: ScoutProgressFn, deep = false) {
    const report = (stage: string, message: string, percent: number, current?: number, total?: number) =>
      onProgress?.({ stage, message, percent, current, total });

    report('account', `Buscando conta ${gameName}#${tagLine}...`, 2);
    const account = await this.riotService.getAccount(gameName, tagLine);

    report('team', 'Procurando time de Clash...', 5);
    const clashPlayers = await this.riotService.getClashPlayersByPuuid(account.puuid);
    if (!clashPlayers.length) {
      throw new BadRequestException(`${gameName}#${tagLine} não está registrado em nenhum time de Clash ativo.`);
    }

    const team = await this.resolveCurrentClashTeam(clashPlayers);
    const championMap = await this.riotService.getChampionIdNameMap();

    const players: FullPlayerData[] = [];
    const members = team.players as { puuid: string; position: string }[];
    const total = members.length;

    for (let i = 0; i < total; i++) {
      const member = members[i];
      // 10% → 88% distribuído entre os jogadores do time
      report(
        'players',
        `Analisando jogador ${i + 1}/${total} do time "${team.name ?? '???'}": histórico, ranks, maestria${deep ? ' e leitura de mapa' : ''}...`,
        10 + Math.round((i / total) * 78),
        i + 1,
        total,
      );
      try {
        players.push(
          await this.playerStatsService.buildFromPuuid(member.puuid, championMap, member.position, undefined, deep),
        );
      } catch (err) {
        this.logger.warn(`Falha ao processar ${member.puuid}: ${(err as any)?.message}`);
      }
    }

    report('ai', 'Gerando recomendações de ban e estratégia com IA...', 90);
    let analysis: AiAnalysis = { generatedByAi: false, bans: [], counterplays: [], predictedPicks: [], strategy: '' };
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
      ...this.publicAiAnalysis(analysis),
    };
  }

  async retryAiAnalysis(players: FullPlayerData[]) {
    const analysis = await this.aiService.analyzeOpponents(players, true);
    return this.publicAiAnalysis(analysis);
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

  // Histórico de relatórios — o nick pesquisado e o modo ficam em data.meta
  // (gravados pelo auto-save da fila), sem precisar de coluna nova.
  async getRecentAnalyses(limit = 8) {
    const records = await this.prisma.clashAnalysis.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 20),
    });
    return records.map((r) => {
      const meta = (r.data as any)?.meta ?? {};
      return {
        id: r.id,
        teamName: r.teamName,
        createdAt: r.createdAt,
        searchedRiotId: typeof meta.searchedRiotId === 'string' ? meta.searchedRiotId : null,
        deep: meta.deep === true,
      };
    });
  }

  private async resolveCurrentClashTeam(clashPlayers: any[]): Promise<any> {
    const teamIds = [...new Set(
      clashPlayers
        .map((player) => String(player?.teamId ?? '').trim())
        .filter(Boolean),
    )];

    const teamResults = await Promise.allSettled(
      teamIds.map((teamId) => this.riotService.getClashTeam(teamId)),
    );
    const teams = teamResults
      .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
      .map((result) => result.value);

    if (!teams.length) {
      throw new NotFoundException('Nenhum time de Clash válido foi encontrado para esse jogador.');
    }
    if (teams.length === 1) return teams[0];

    const tournaments = await this.riotService.getClashTournaments();
    const tournamentOrder = new Map<string, number>();
    for (const tournament of tournaments) {
      const starts = (tournament?.schedule ?? [])
        .map((schedule: any) => Number(schedule?.startTime))
        .filter((startTime: number) => Number.isFinite(startTime));
      tournamentOrder.set(
        String(tournament?.id),
        starts.length ? Math.min(...starts) : Number.MAX_SAFE_INTEGER,
      );
    }

    const activeTeams = teams
      .filter((candidate) => tournamentOrder.has(String(candidate?.tournamentId)))
      .sort((a, b) => (
        tournamentOrder.get(String(a?.tournamentId))!
        - tournamentOrder.get(String(b?.tournamentId))!
      ));

    if (activeTeams.length) return activeTeams[0];

    this.logger.warn(
      `Jogador possui ${teams.length} times de Clash, mas nenhum corresponde aos torneios ativos; usando o primeiro retornado pela Riot.`,
    );
    return teams[0];
  }

  private publicAiAnalysis(analysis: AiAnalysis) {
    return {
      aiGenerated: analysis.generatedByAi,
      bans: analysis.generatedByAi ? analysis.bans : [],
      counterplays: analysis.generatedByAi ? analysis.counterplays : [],
      predictedPicks: analysis.generatedByAi ? analysis.predictedPicks : [],
      strategy: analysis.generatedByAi ? analysis.strategy : '',
      gamePlan: analysis.generatedByAi ? analysis.gamePlan : undefined,
    };
  }
}
