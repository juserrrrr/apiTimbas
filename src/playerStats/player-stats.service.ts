import { Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { RiotService } from '../riot/riot.service';
import { FullPlayerData, PlaystyleStats, QueueChampStat, QueuePerf } from '../ai/ai.service';

interface ChampAccum {
  championId: number;
  championName: string;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
}

const MATCH_HISTORY_COUNTS = {
  SOLO: 12,
  FLEX: 6,
  CLASH: 5,
} as const;

export type RiotPlayerStats = FullPlayerData & {
  topPositions: string[];
  profileIconId: number;
  profileIconUrl: string;
};

const EMPTY_PLAYSTYLE: PlaystyleStats = {
  avgKills: 0,
  avgDeaths: 0,
  avgAssists: 0,
  avgDamageToChampions: 0,
  avgVisionScore: 0,
  avgKillParticipation: 0,
  avgTeamDragons: 0,
  avgTeamBarons: 0,
  avgDragonTakedowns: 0,
  avgObjectiveSteals: 0,
  avgEnemyJungleMonsterKills: 0,
};

@Injectable()
export class PlayerStatsService {
  constructor(
    private readonly riotService: RiotService,
    private readonly aiService: AiService,
  ) {}

  async getRiotPlayer(gameName: string, tagLine: string) {
    const account = await this.riotService.getAccount(gameName, tagLine);
    const championMap = await this.riotService.getChampionIdNameMap();
    const player = await this.buildFromPuuid(account.puuid, championMap, undefined, account);
    const analysis = await this.aiService.analyzePlayerProfile(player);

    return { player, analysis };
  }

  async buildFromPuuid(
    puuid: string,
    championMap: Map<number, string>,
    clashPosition?: string,
    accountOverride?: { gameName: string; tagLine: string },
  ): Promise<RiotPlayerStats> {
    let summoner: any;
    try {
      summoner = await this.riotService.getSummonerByPuuid(puuid);
    } catch {
      summoner = { profileIconId: 0, summonerLevel: 0 };
    }
    const account = accountOverride ?? await this.getAccountFallback(puuid, summoner);
    const ranked = await this.riotService.getRankedStats(puuid);
    const mastery = await this.riotService.getChampionMastery(puuid, 10);

    const solo = ranked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5') ?? {};
    const flex = ranked.find((r: any) => r.queueType === 'RANKED_FLEX_SR') ?? {};

    const [soloIds, flexIds, clashIds] = await Promise.all([
      this.riotService.getMatchHistory(puuid, MATCH_HISTORY_COUNTS.SOLO, 420),
      this.riotService.getMatchHistory(puuid, MATCH_HISTORY_COUNTS.FLEX, 440),
      this.riotService.getMatchHistory(puuid, MATCH_HISTORY_COUNTS.CLASH, 700),
    ]);

    const posFilter = clashPosition ? this.normalizePosition(clashPosition) : undefined;
    const effectivePosFilter = posFilter && posFilter !== 'FILL' ? posFilter : undefined;
    const [soloQueue, flexQueue, clashHistory] = await Promise.all([
      this.buildQueuePerf(puuid, soloIds, effectivePosFilter),
      this.buildQueuePerf(puuid, flexIds, effectivePosFilter),
      this.buildQueuePerf(puuid, clashIds, effectivePosFilter),
    ]);

    const soloWins = solo.wins ?? 0;
    const soloLosses = solo.losses ?? 0;
    const flexWins = flex.wins ?? 0;
    const flexLosses = flex.losses ?? 0;
    const topPositions = this.buildTopPositions(soloQueue, flexQueue, clashHistory);
    const normalizedPosition = clashPosition ? this.normalizePosition(clashPosition) : '';

    return {
      riotId: `${account.gameName}#${account.tagLine}`,
      position: normalizedPosition || topPositions[0] || 'FILL',
      topPositions,
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
      masteryTop10: mastery.slice(0, 10).map((m: any) => ({
        championId: m.championId,
        championName: championMap.get(m.championId) ?? String(m.championId),
        masteryLevel: m.championLevel,
        masteryPoints: m.championPoints,
      })),
      soloQueue,
      flexQueue,
      clashHistory,
      combinedTopChamps: this.buildCombinedStats(soloQueue, flexQueue, clashHistory),
      profileIconId: summoner.profileIconId,
      profileIconUrl: await this.riotService.buildProfileIconUrl(summoner.profileIconId),
    };
  }

  private async buildQueuePerf(puuid: string, matchIds: string[], positionFilter?: string): Promise<QueuePerf> {
    if (!matchIds.length) return { games: 0, winrate: 0, avgKda: 0, topChampions: [], roleDistribution: [], playstyle: EMPTY_PLAYSTYLE };

    const allMatches: any[] = [];
    for (let i = 0; i < matchIds.length; i += 5) {
      const results = await Promise.all(matchIds.slice(i, i + 5).map((id) => this.riotService.getMatch(id)));
      allMatches.push(...results.filter(Boolean));
    }

    const champMap = new Map<number, ChampAccum>();
    const roleMap = new Map<string, number>();
    let wins = 0, kills = 0, deaths = 0, assists = 0;
    let damageToChampions = 0;
    let visionScore = 0;
    let killParticipation = 0;
    let teamDragons = 0;
    let teamBarons = 0;
    let dragonTakedowns = 0;
    let objectiveSteals = 0;
    let enemyJungleMonsterKills = 0;
    let processedGames = 0;

    for (const match of allMatches) {
      const p = (match.info?.participants ?? []).find((x: any) => x.puuid === puuid);
      if (!p) continue;
      processedGames++;
      if (p.win) wins++;
      const role = this.normalizePosition(p.teamPosition || p.individualPosition || p.lane || p.role);
      if (role !== 'FILL') roleMap.set(role, (roleMap.get(role) ?? 0) + 1);
      kills += p.kills ?? 0;
      deaths += p.deaths ?? 0;
      assists += p.assists ?? 0;
      damageToChampions += p.totalDamageDealtToChampions ?? 0;
      visionScore += p.visionScore ?? 0;
      killParticipation += this.getKillParticipation(p, match);
      const objectives = this.getParticipantTeamObjectives(match, p.teamId);
      teamDragons += objectives.dragons;
      teamBarons += objectives.barons;
      dragonTakedowns += p.challenges?.dragonTakedowns ?? 0;
      objectiveSteals += p.objectivesStolen ?? p.challenges?.epicMonsterSteals ?? 0;
      enemyJungleMonsterKills += p.challenges?.enemyJungleMonsterKills ?? p.neutralMinionsKilledEnemyJungle ?? 0;

      // Only count this game's champion toward topChampions when it matches the
      // Clash position. If Riot does not expose a usable role, keep the champion
      // instead of showing Clash games with no champion icons.
      if (positionFilter && role !== positionFilter && role !== 'FILL') continue;

      const cid: number = p.championId;
      const ex = champMap.get(cid) ?? {
        championId: cid,
        championName: p.championName ?? String(cid),
        games: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
      };
      ex.games++;
      if (p.win) ex.wins++;
      ex.kills += p.kills ?? 0;
      ex.deaths += p.deaths ?? 0;
      ex.assists += p.assists ?? 0;
      champMap.set(cid, ex);
    }

    const total = processedGames;
    return {
      games: total,
      winrate: total > 0 ? Math.round((wins / total) * 100) : 0,
      avgKda: deaths === 0 ? kills + assists : Math.round(((kills + assists) / deaths) * 10) / 10,
      topChampions: [...champMap.values()]
        .sort((a, b) => b.games - a.games)
        .slice(0, 8)
        .map((c) => ({
          championId: c.championId,
          championName: c.championName,
          games: c.games,
          wins: c.wins,
          winrate: c.games > 0 ? Math.round((c.wins / c.games) * 100) : 0,
          kda: c.deaths === 0 ? c.kills + c.assists : Math.round(((c.kills + c.assists) / c.deaths) * 10) / 10,
        })),
      roleDistribution: this.buildRoleDistribution(roleMap, total),
      playstyle: this.buildPlaystyle({
        total,
        kills,
        deaths,
        assists,
        damageToChampions,
        visionScore,
        killParticipation,
        teamDragons,
        teamBarons,
        dragonTakedowns,
        objectiveSteals,
        enemyJungleMonsterKills,
      }),
    };
  }

  private getKillParticipation(participant: any, match: any): number {
    const fromChallenges = participant.challenges?.killParticipation;
    if (typeof fromChallenges === 'number') return fromChallenges * 100;

    const teamKills = (match.info?.participants ?? [])
      .filter((p: any) => p.teamId === participant.teamId)
      .reduce((sum: number, p: any) => sum + (p.kills ?? 0), 0);

    if (!teamKills) return 0;
    return (((participant.kills ?? 0) + (participant.assists ?? 0)) / teamKills) * 100;
  }

  private getParticipantTeamObjectives(match: any, teamId: number): { dragons: number; barons: number } {
    const team = (match.info?.teams ?? []).find((t: any) => t.teamId === teamId);
    return {
      dragons: team?.objectives?.dragon?.kills ?? 0,
      barons: team?.objectives?.baron?.kills ?? 0,
    };
  }

  private buildPlaystyle(stats: {
    total: number;
    kills: number;
    deaths: number;
    assists: number;
    damageToChampions: number;
    visionScore: number;
    killParticipation: number;
    teamDragons: number;
    teamBarons: number;
    dragonTakedowns: number;
    objectiveSteals: number;
    enemyJungleMonsterKills: number;
  }): PlaystyleStats {
    if (!stats.total) return EMPTY_PLAYSTYLE;
    const avg = (value: number, precision = 1) => Math.round((value / stats.total) * (10 ** precision)) / (10 ** precision);

    return {
      avgKills: avg(stats.kills),
      avgDeaths: avg(stats.deaths),
      avgAssists: avg(stats.assists),
      avgDamageToChampions: Math.round(stats.damageToChampions / stats.total),
      avgVisionScore: avg(stats.visionScore),
      avgKillParticipation: Math.round(stats.killParticipation / stats.total),
      avgTeamDragons: avg(stats.teamDragons),
      avgTeamBarons: avg(stats.teamBarons),
      avgDragonTakedowns: avg(stats.dragonTakedowns),
      avgObjectiveSteals: avg(stats.objectiveSteals),
      avgEnemyJungleMonsterKills: avg(stats.enemyJungleMonsterKills),
    };
  }

  private buildRoleDistribution(roleMap: Map<string, number>, totalGames: number) {
    if (!totalGames) return [];
    return [...roleMap.entries()]
      .map(([role, games]) => ({ role, games, share: Math.round((games / totalGames) * 100) }))
      .sort((a, b) => b.games - a.games);
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
      .map(({ score: _score, ...c }) => ({ ...c, winrate: c.games > 0 ? Math.round((c.wins / c.games) * 100) : 0 }));
  }

  private buildTopPositions(...queues: QueuePerf[]): string[] {
    const roleMap = new Map<string, number>();
    for (const queue of queues) {
      for (const role of queue.roleDistribution) {
        roleMap.set(role.role, (roleMap.get(role.role) ?? 0) + role.games);
      }
    }
    return [...roleMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([role]) => role);
  }

  private normalizePosition(pos: string): string {
    const map: Record<string, string> = {
      TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', MID: 'MID',
      BOTTOM: 'ADC', BOT: 'ADC', UTILITY: 'SUPPORT', SUPPORT: 'SUPPORT',
      FILL: 'FILL', UNSELECTED: 'FILL',
    };
    return map[pos?.toUpperCase()] ?? pos ?? 'FILL';
  }

  private async getAccountFallback(puuid: string, summoner?: any): Promise<{ gameName: string; tagLine: string }> {
    const data = await this.riotService.getAccountByPuuid(puuid);
    if (data) return data;
    const name = summoner?.name ?? summoner?.gameName;
    return {
      gameName: name || 'Jogador',
      tagLine: puuid.slice(0, 4),
    };
  }
}
