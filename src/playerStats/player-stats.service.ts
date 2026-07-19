import { Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { RiotService } from '../riot/riot.service';
import { FullPlayerData, MapProfile, MapRegionStats, PlaystyleStats, QueueChampStat, QueuePerf, TeamTacticalProfile } from '../ai/ai.service';

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
  SOLO: 20,
  FLEX: 10,
  CLASH: 10,
} as const;

const PROFILE_TIMELINE_LIMITS = { JUNGLE: 16, DEFAULT: 8 } as const;

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
  avgGoldEarned: 0,
  avgCs: 0,
  avgDamageTaken: 0,
  avgWardsPlaced: 0,
  avgWardsKilled: 0,
  avgControlWards: 0,
  avgTurretTakedowns: 0,
};

const EMPTY_REGIONS: MapRegionStats = {
  top: 0,
  mid: 0,
  bot: 0,
  alliedJungle: 0,
  enemyJungle: 0,
  river: 0,
  unknown: 0,
};

const EMPTY_MAP_PROFILE: MapProfile = {
  games: 0,
  earlyPresence: EMPTY_REGIONS,
  fightRegions: EMPTY_REGIONS,
  deathRegions: EMPTY_REGIONS,
  objectiveFights: 0,
  invades: 0,
  startSide: 'inconclusivo',
  earlyGanksPerGame: 0,
  mostVisited: 'inconclusivo',
  mostFought: 'inconclusivo',
  mostDeaths: 'inconclusivo',
  likelyGankFocus: 'inconclusivo',
  ganksByLane: { top: 0, mid: 0, bot: 0, total: 0 },
  firstGanksByLane: { top: 0, mid: 0, bot: 0, total: 0 },
  firstGankFocus: 'inconclusivo',
  avgFirstGankMinute: null,
  roamsByLane: { top: 0, mid: 0, bot: 0, total: 0 },
  roamsPerGame: 0,
  roamFocus: 'inconclusivo',
  invadeGames: 0,
  invadeRate: 0,
  startSideGames: { top: 0, bottom: 0, unknown: 0 },
  startSideConfidence: 0,
  objectiveBreakdown: { dragons: 0, barons: 0, heralds: 0, other: 0 },
  wardsPlaced: 0,
  visionFocus: 'inconclusivo',
  sampleConfidence: 'baixa',
};

// Janela de posição usada apenas como sinal probabilístico do lado inicial.
const START_SIDE_WINDOW_MS: [number, number] = [60_000, 165_000];
const LANE_REGIONS = new Set(['top', 'mid', 'bot']);
const EARLY_PHASE_MAX_MINUTE = 14;

@Injectable()
export class PlayerStatsService {
  constructor(
    private readonly riotService: RiotService,
    private readonly aiService: AiService,
  ) {}

  async buildTeamTacticalProfile(members: { puuid: string; riotId: string }[]): Promise<TeamTacticalProfile | undefined> {
    if (members.length < 3) return undefined;
    const histories = await Promise.all(members.map((member) => this.riotService.getMatchHistory(member.puuid, MATCH_HISTORY_COUNTS.CLASH, 700)));
    const frequency = new Map<string, number>();
    for (const ids of histories) for (const id of new Set(ids)) frequency.set(id, (frequency.get(id) ?? 0) + 1);
    const sharedIds = [...frequency.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id);
    if (!sharedIds.length) return undefined;

    const puuids = new Set(members.map((member) => member.puuid));
    const riotIdByPuuid = new Map(members.map((member) => [member.puuid, member.riotId]));
    const damageByPuuid = new Map<string, number>();
    let games = 0, wins = 0, duration = 0, kills = 0, deaths = 0;
    let dragons = 0, barons = 0, towers = 0, firstBloods = 0, firstTowers = 0, teamDamage = 0;

    for (const matchId of sharedIds) {
      const match = await this.riotService.getMatch(matchId);
      const participants = (match?.info?.participants ?? []).filter((participant: any) => puuids.has(participant.puuid));
      if (participants.length < 3) continue;
      const teamCounts = new Map<number, number>();
      for (const participant of participants) teamCounts.set(participant.teamId, (teamCounts.get(participant.teamId) ?? 0) + 1);
      const teamId = [...teamCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const teamMembers = participants.filter((participant: any) => participant.teamId === teamId);
      if (teamMembers.length < 3) continue;
      const team = (match.info?.teams ?? []).find((candidate: any) => candidate.teamId === teamId);
      const enemyTeam = (match.info?.teams ?? []).find((candidate: any) => candidate.teamId !== teamId);
      games++;
      if (team?.win ?? teamMembers[0]?.win) wins++;
      duration += match.info?.gameDuration ?? 0;
      kills += team?.objectives?.champion?.kills
        ?? teamMembers.reduce((sum: number, participant: any) => sum + (participant.kills ?? 0), 0);
      deaths += enemyTeam?.objectives?.champion?.kills
        ?? teamMembers.reduce((sum: number, participant: any) => sum + (participant.deaths ?? 0), 0);
      dragons += team?.objectives?.dragon?.kills ?? 0;
      barons += team?.objectives?.baron?.kills ?? 0;
      towers += team?.objectives?.tower?.kills ?? 0;
      if (team?.objectives?.champion?.first) firstBloods++;
      if (team?.objectives?.tower?.first) firstTowers++;
      for (const participant of teamMembers) {
        const damage = participant.totalDamageDealtToChampions ?? 0;
        teamDamage += damage;
        damageByPuuid.set(participant.puuid, (damageByPuuid.get(participant.puuid) ?? 0) + damage);
      }
    }
    if (!games) return undefined;
    const [carryPuuid, carryDamage = 0] = [...damageByPuuid.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    const avg = (value: number) => Math.round((value / games) * 10) / 10;
    return {
      games,
      wins,
      winrate: Math.round((wins / games) * 100),
      avgDurationMinutes: avg(duration / 60),
      avgKills: avg(kills),
      avgDeaths: avg(deaths),
      avgDragons: avg(dragons),
      avgBarons: avg(barons),
      avgTowers: avg(towers),
      firstBloodRate: Math.round((firstBloods / games) * 100),
      firstTowerRate: Math.round((firstTowers / games) * 100),
      mainCarry: riotIdByPuuid.get(carryPuuid) ?? 'inconclusivo',
      mainCarryDamageShare: teamDamage ? Math.round((carryDamage / teamDamage) * 100) : 0,
      sampleConfidence: games >= 8 ? 'alta' : games >= 4 ? 'media' : 'baixa',
    };
  }

  async getRiotPlayer(gameName: string, tagLine: string) {
    const account = await this.riotService.getAccount(gameName, tagLine);
    const championMap = await this.riotService.getChampionIdNameMap();
    const player = await this.buildFromPuuid(account.puuid, championMap, undefined, account, true);
    const analysis = await this.aiService.analyzePlayerProfile(player);

    return { player, analysis };
  }

  async buildFromPuuid(
    puuid: string,
    championMap: Map<number, string>,
    clashPosition?: string,
    accountOverride?: { gameName: string; tagLine: string },
    includeTimeline = false,
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
    const timelineIds = posFilter === 'JUNGLE'
      ? [...clashIds.slice(0, 8), ...flexIds.slice(0, 4), ...soloIds.slice(0, 8)]
      : [...clashIds.slice(0, 3), ...flexIds.slice(0, 2), ...soloIds.slice(0, 5)];
    const mapProfile = includeTimeline
      ? await this.buildMapProfile(puuid, timelineIds, posFilter ?? 'FILL')
      : undefined;

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
      mapProfile,
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
    let goldEarned = 0, cs = 0, damageTaken = 0, wardsPlaced = 0;
    let wardsKilled = 0, controlWards = 0, turretTakedowns = 0;
    let processedGames = 0;
    let roleObservedGames = 0;

    for (const match of allMatches) {
      const p = (match.info?.participants ?? []).find((x: any) => x.puuid === puuid);
      if (!p) continue;
      const role = this.normalizePosition(p.teamPosition || p.individualPosition || p.lane || p.role);
      if (role !== 'FILL') {
        roleMap.set(role, (roleMap.get(role) ?? 0) + 1);
        roleObservedGames++;
      }
      if (positionFilter && role !== positionFilter && role !== 'FILL') continue;

      processedGames++;
      if (p.win) wins++;
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
      goldEarned += p.goldEarned ?? 0;
      cs += (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0);
      damageTaken += p.totalDamageTaken ?? 0;
      wardsPlaced += p.wardsPlaced ?? 0;
      wardsKilled += p.wardsKilled ?? 0;
      controlWards += p.detectorWardsPlaced ?? p.visionWardsBoughtInGame ?? 0;
      turretTakedowns += p.turretTakedowns ?? ((p.turretKills ?? 0) + (p.turretAssists ?? 0));

      // Only count this game's champion toward topChampions when it matches the
      // Clash position. If Riot does not expose a usable role, keep the champion
      // instead of showing Clash games with no champion icons.
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
      roleDistribution: this.buildRoleDistribution(roleMap, roleObservedGames),
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
        goldEarned,
        cs,
        damageTaken,
        wardsPlaced,
        wardsKilled,
        controlWards,
        turretTakedowns,
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
    goldEarned: number;
    cs: number;
    damageTaken: number;
    wardsPlaced: number;
    wardsKilled: number;
    controlWards: number;
    turretTakedowns: number;
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
      avgGoldEarned: Math.round(stats.goldEarned / stats.total),
      avgCs: Math.round(stats.cs / stats.total),
      avgDamageTaken: Math.round(stats.damageTaken / stats.total),
      avgWardsPlaced: avg(stats.wardsPlaced),
      avgWardsKilled: avg(stats.wardsKilled),
      avgControlWards: avg(stats.controlWards),
      avgTurretTakedowns: avg(stats.turretTakedowns),
    };
  }

  private async buildMapProfile(puuid: string, matchIds: string[], playerPosition: string): Promise<MapProfile> {
    const isJungler = playerPosition === 'JUNGLE';
    const ids = [...new Set(matchIds)].slice(0, isJungler ? PROFILE_TIMELINE_LIMITS.JUNGLE : PROFILE_TIMELINE_LIMITS.DEFAULT);
    if (!ids.length) return EMPTY_MAP_PROFILE;

    const earlyPresence = this.emptyRegions();
    const fightRegions = this.emptyRegions();
    const deathRegions = this.emptyRegions();
    let objectiveFights = 0;
    let invadeGames = 0;
    let games = 0;
    let earlyGanks = 0;
    let earlyRoams = 0;
    let firstGankMinuteTotal = 0;
    let firstGankGames = 0;
    let wardsPlaced = 0;
    const ganksByLane = { top: 0, mid: 0, bot: 0, total: 0 };
    const firstGanksByLane = { top: 0, mid: 0, bot: 0, total: 0 };
    const roamsByLane = { top: 0, mid: 0, bot: 0, total: 0 };
    const startSideGames = { top: 0, bottom: 0, unknown: 0 };
    const objectiveBreakdown = { dragons: 0, barons: 0, heralds: 0, other: 0 };
    const visionRegions = this.emptyRegions();
    const homeLane = playerPosition === 'TOP' ? 'top' : playerPosition === 'MID' ? 'mid' : ['ADC', 'SUPPORT'].includes(playerPosition) ? 'bot' : null;

    for (let i = 0; i < ids.length; i += 2) {
      const pairs = await Promise.all(ids.slice(i, i + 2).map(async (id) => ({
        match: await this.riotService.getMatch(id),
        timeline: await this.riotService.getMatchTimeline(id),
      })));

      for (const { match, timeline } of pairs) {
        const participant = (match?.info?.participants ?? []).find((p: any) => p.puuid === puuid);
        const timelineParticipant = (timeline?.info?.participants ?? []).find((p: any) => p.puuid === puuid);
        const participantId = timelineParticipant?.participantId;
        if (!participant || !participantId || !timeline?.info?.frames?.length) continue;
        games++;

        let topStartVotes = 0;
        let botStartVotes = 0;
        let invadedThisGame = false;
        let firstGank: { lane: 'top' | 'mid' | 'bot'; minute: number } | null = null;

        for (const frame of timeline.info.frames) {
          const frameTs = frame.timestamp ?? 0;
          const minute = Math.floor(frameTs / 60000);
          const participantFrame = frame.participantFrames?.[String(participantId)];
          const position = participantFrame?.position;
          if (position && minute <= EARLY_PHASE_MAX_MINUTE) {
            const region = this.classifyMapRegion(position.x, position.y, participant.teamId);
            earlyPresence[region]++;
            if (region === 'enemyJungle') invadedThisGame = true;
          }

          // Rota inicial: acima da diagonal (y > x) = metade superior do mapa
          if (position && frameTs >= START_SIDE_WINDOW_MS[0] && frameTs <= START_SIDE_WINDOW_MS[1]) {
            if (position.y > position.x + 800) topStartVotes++;
            else if (position.x > position.y + 800) botStartVotes++;
          }

          for (const event of frame.events ?? []) {
            const region = this.classifyMapRegion(event.position?.x, event.position?.y, participant.teamId);
            const eventMinute = Math.floor((event.timestamp ?? frameTs) / 60000);
            if (event.type === 'CHAMPION_KILL') {
              const involved = event.killerId === participantId || (event.assistingParticipantIds ?? []).includes(participantId);
              if (involved) fightRegions[region]++;
              if (involved && eventMinute <= EARLY_PHASE_MAX_MINUTE && LANE_REGIONS.has(region)) {
                const lane = region as 'top' | 'mid' | 'bot';
                if (isJungler) {
                  earlyGanks++;
                  ganksByLane[lane]++;
                  ganksByLane.total++;
                  if (!firstGank) firstGank = { lane, minute: (event.timestamp ?? frameTs) / 60000 };
                } else if (homeLane && lane !== homeLane) {
                  earlyRoams++;
                  roamsByLane[lane]++;
                  roamsByLane.total++;
                }
              }
              if (event.victimId === participantId) deathRegions[region]++;
            }
            if (event.type === 'ELITE_MONSTER_KILL') {
              const involved = event.killerId === participantId || (event.assistingParticipantIds ?? []).includes(participantId);
              if (involved) {
                objectiveFights++;
                const monster = String(event.monsterType ?? '').toUpperCase();
                if (monster === 'DRAGON') objectiveBreakdown.dragons++;
                else if (monster === 'BARON_NASHOR') objectiveBreakdown.barons++;
                else if (monster.includes('RIFTHERALD') || monster.includes('HORDE')) objectiveBreakdown.heralds++;
                else objectiveBreakdown.other++;
              }
            }
            if (event.type === 'WARD_PLACED' && event.creatorId === participantId) {
              wardsPlaced++;
              visionRegions[region]++;
            }
          }
        }

        if (invadedThisGame) invadeGames++;
        if (firstGank) {
          firstGanksByLane[firstGank.lane]++;
          firstGanksByLane.total++;
          firstGankMinuteTotal += firstGank.minute;
          firstGankGames++;
        }
        if (isJungler && topStartVotes > botStartVotes) startSideGames.top++;
        else if (isJungler && botStartVotes > topStartVotes) startSideGames.bottom++;
        else startSideGames.unknown++;
      }
    }

    const conclusiveStarts = startSideGames.top + startSideGames.bottom;
    const dominantStarts = Math.max(startSideGames.top, startSideGames.bottom);
    const startSide = !isJungler || dominantStarts === 0
      ? 'inconclusivo'
      : startSideGames.top > startSideGames.bottom ? 'topo' : startSideGames.bottom > startSideGames.top ? 'baixo' : 'inconclusivo';
    const laneFocus = (stats: { top: number; mid: number; bot: number }) => this.likelyGankFocus({ ...EMPTY_REGIONS, ...stats });

    return {
      games,
      earlyPresence,
      fightRegions,
      deathRegions,
      objectiveFights,
      invades: invadeGames,
      startSide,
      earlyGanksPerGame: games > 0 ? Math.round((earlyGanks / games) * 10) / 10 : 0,
      mostVisited: this.topRegionName(earlyPresence),
      mostFought: this.topRegionName(fightRegions),
      mostDeaths: this.topRegionName(deathRegions),
      likelyGankFocus: isJungler ? laneFocus(ganksByLane) : this.likelyGankFocus(fightRegions),
      ganksByLane,
      firstGanksByLane,
      firstGankFocus: laneFocus(firstGanksByLane),
      avgFirstGankMinute: firstGankGames ? Math.round((firstGankMinuteTotal / firstGankGames) * 10) / 10 : null,
      roamsByLane,
      roamsPerGame: games ? Math.round((earlyRoams / games) * 10) / 10 : 0,
      roamFocus: laneFocus(roamsByLane),
      invadeGames,
      invadeRate: games ? Math.round((invadeGames / games) * 100) : 0,
      startSideGames,
      startSideConfidence: conclusiveStarts ? Math.round((dominantStarts / conclusiveStarts) * 100) : 0,
      objectiveBreakdown,
      wardsPlaced,
      visionFocus: this.topRegionName(visionRegions),
      sampleConfidence: games >= 10 ? 'alta' : games >= 6 ? 'media' : 'baixa',
    };
  }

  private emptyRegions(): MapRegionStats {
    return { ...EMPTY_REGIONS };
  }

  private classifyMapRegion(x?: number, y?: number, teamId?: number): keyof MapRegionStats {
    if (typeof x !== 'number' || typeof y !== 'number') return 'unknown';
    if (y > 9800 && x < 6800) return 'top';
    if (x > 9800 && y < 6800) return 'bot';
    if (Math.abs(x - y) < 2300 && x > 3500 && x < 11500 && y > 3500 && y < 11500) return 'mid';
    if (x > 4500 && x < 10500 && y > 4500 && y < 10500) return 'river';

    const blueSideJungle = x < 7200 && y < 7200;
    const redSideJungle = x > 7200 && y > 7200;
    if (teamId === 100) {
      if (redSideJungle) return 'enemyJungle';
      if (blueSideJungle) return 'alliedJungle';
    }
    if (teamId === 200) {
      if (blueSideJungle) return 'enemyJungle';
      if (redSideJungle) return 'alliedJungle';
    }
    return 'unknown';
  }

  private topRegionName(stats: MapRegionStats): string {
    const [region, count] = Object.entries(stats)
      .filter(([key]) => key !== 'unknown')
      .sort((a, b) => b[1] - a[1])[0] ?? ['inconclusivo', 0];
    return count > 0 ? this.regionLabel(region) : 'inconclusivo';
  }

  private likelyGankFocus(stats: MapRegionStats): string {
    const lanes: [string, number][] = [
      ['top', stats.top],
      ['mid', stats.mid],
      ['bot', stats.bot],
    ];
    const [lane, count] = lanes.sort((a, b) => b[1] - a[1])[0];
    return count > 0 ? this.regionLabel(lane) : 'inconclusivo';
  }

  private regionLabel(region: string): string {
    const labels: Record<string, string> = {
      top: 'top',
      mid: 'mid',
      bot: 'bot',
      alliedJungle: 'jungle aliada',
      enemyJungle: 'jungle inimiga',
      river: 'rio/objetivos',
      unknown: 'inconclusivo',
      inconclusivo: 'inconclusivo',
    };
    return labels[region] ?? region;
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

    // Para Clash, partidas coordenadas e Flex dizem mais sobre o draft que SoloQ.
    add(solo.topChampions, 0.45);
    add(flex.topChampions, 0.7);
    add(clash.topChampions, 1);

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
