import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { RiotService } from '../riot/riot.service';
import { AiService, FullPlayerData, QueuePerf, QueueChampStat, AiAnalysis } from '../ai/ai.service';

interface ChampAccum {
  championId: number;
  championName: string;
  games: number; wins: number;
  kills: number; deaths: number; assists: number;
}

@Injectable()
export class ClashService {
  private readonly logger = new Logger(ClashService.name);

  constructor(
    private readonly riotService: RiotService,
    private readonly aiService: AiService,
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
        const summoner = await this.riotService.getSummonerByPuuid(member.puuid);
        const memberAccount = await this.riotService.getAccountByPuuid(member.puuid);
        const ranked = await this.riotService.getRankedStats(member.puuid);
        const mastery = await this.riotService.getChampionMastery(summoner.puuid, 10);

        const solo = ranked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5') ?? {};
        const flex = ranked.find((r: any) => r.queueType === 'RANKED_FLEX_SR') ?? {};

        const [soloIds, flexIds, clashIds] = await Promise.all([
          this.riotService.getMatchHistory(summoner.puuid, 20, 420),
          this.riotService.getMatchHistory(summoner.puuid, 10, 440),
          this.riotService.getMatchHistory(summoner.puuid, 10, 700),
        ]);

        const [soloQueue, flexQueue, clashHistory] = await Promise.all([
          this.buildQueuePerf(summoner.puuid, soloIds),
          this.buildQueuePerf(summoner.puuid, flexIds),
          this.buildQueuePerf(summoner.puuid, clashIds),
        ]);

        const combinedTopChamps = this.buildCombinedStats(soloQueue, flexQueue, clashHistory);

        const masteryTop10 = mastery.slice(0, 10).map((m: any) => ({
          championId: m.championId,
          championName: championMap.get(m.championId) ?? String(m.championId),
          masteryLevel: m.championLevel,
          masteryPoints: m.championPoints,
        }));

        const soloWins = solo.wins ?? 0;
        const soloLosses = solo.losses ?? 0;
        const flexWins = flex.wins ?? 0;
        const flexLosses = flex.losses ?? 0;

        players.push({
          riotId: `${memberAccount.gameName}#${memberAccount.tagLine}`,
          position: this.normalizePosition(member.position),
          soloRank: {
            tier: solo.tier ?? 'UNRANKED',
            rank: solo.rank ?? '',
            lp: solo.leaguePoints ?? 0,
            wins: soloWins,
            losses: soloLosses,
          },
          flexRank: {
            tier: flex.tier ?? 'UNRANKED',
            rank: flex.rank ?? '',
            lp: flex.leaguePoints ?? 0,
            wins: flexWins,
            losses: flexLosses,
          },
          soloSeasonWinrate: soloWins + soloLosses > 0
            ? Math.round((soloWins / (soloWins + soloLosses)) * 100) : 0,
          flexSeasonWinrate: flexWins + flexLosses > 0
            ? Math.round((flexWins / (flexWins + flexLosses)) * 100) : 0,
          masteryTop10,
          soloQueue,
          flexQueue,
          clashHistory,
          combinedTopChamps,
          profileIconId: summoner.profileIconId,
          profileIconUrl: this.riotService.buildProfileIconUrl(summoner.profileIconId),
        } as any);
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async buildQueuePerf(puuid: string, matchIds: string[]): Promise<QueuePerf> {
    if (!matchIds.length) return { games: 0, winrate: 0, avgKda: 0, topChampions: [] };

    const BATCH = 5;
    const allMatches: any[] = [];
    for (let i = 0; i < matchIds.length; i += BATCH) {
      const results = await Promise.all(
        matchIds.slice(i, i + BATCH).map((id) => this.riotService.getMatch(id)),
      );
      allMatches.push(...results.filter(Boolean));
    }

    const champMap = new Map<number, ChampAccum>();
    let wins = 0, kills = 0, deaths = 0, assists = 0;

    for (const match of allMatches) {
      const p = (match.info?.participants ?? []).find((x: any) => x.puuid === puuid);
      if (!p) continue;
      if (p.win) wins++;
      kills += p.kills ?? 0;
      deaths += p.deaths ?? 0;
      assists += p.assists ?? 0;

      const cid: number = p.championId;
      const ex = champMap.get(cid) ?? {
        championId: cid,
        championName: p.championName ?? String(cid),
        games: 0, wins: 0, kills: 0, deaths: 0, assists: 0,
      };
      ex.games++;
      if (p.win) ex.wins++;
      ex.kills += p.kills ?? 0;
      ex.deaths += p.deaths ?? 0;
      ex.assists += p.assists ?? 0;
      champMap.set(cid, ex);
    }

    const total = allMatches.length;
    const topChampions: QueueChampStat[] = [...champMap.values()]
      .sort((a, b) => b.games - a.games)
      .slice(0, 8)
      .map((c) => ({
        championId: c.championId,
        championName: c.championName,
        games: c.games,
        wins: c.wins,
        winrate: c.games > 0 ? Math.round((c.wins / c.games) * 100) : 0,
        kda: c.deaths === 0
          ? c.kills + c.assists
          : Math.round(((c.kills + c.assists) / c.deaths) * 10) / 10,
      }));

    return {
      games: total,
      winrate: total > 0 ? Math.round((wins / total) * 100) : 0,
      avgKda: deaths === 0 ? kills + assists : Math.round(((kills + assists) / deaths) * 10) / 10,
      topChampions,
    };
  }

  private buildCombinedStats(solo: QueuePerf, flex: QueuePerf, clash: QueuePerf): QueueChampStat[] {
    const scoreMap = new Map<string, QueueChampStat & { score: number }>();

    const add = (champs: QueueChampStat[], weight: number) => {
      for (const c of champs) {
        const existing = scoreMap.get(c.championName);
        if (existing) {
          existing.games += c.games;
          existing.wins += c.wins;
          existing.score += c.games * weight;
        } else {
          scoreMap.set(c.championName, { ...c, score: c.games * weight });
        }
      }
    };

    add(solo.topChampions, 0.6);
    add(flex.topChampions, 0.25);
    add(clash.topChampions, 0.15);

    return [...scoreMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ score: _score, ...c }) => ({
        ...c,
        winrate: c.games > 0 ? Math.round((c.wins / c.games) * 100) : 0,
      }));
  }

  private normalizePosition(pos: string): string {
    const map: Record<string, string> = {
      TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', MID: 'MID',
      BOTTOM: 'ADC', BOT: 'ADC', UTILITY: 'SUPPORT', SUPPORT: 'SUPPORT',
      FILL: 'FILL', UNSELECTED: 'FILL',
    };
    return map[pos?.toUpperCase()] ?? pos ?? 'FILL';
  }
}
