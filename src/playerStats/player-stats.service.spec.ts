import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from '../ai/ai.service';
import { RiotService } from '../riot/riot.service';
import { PlayerStatsService } from './player-stats.service';

const PUUID = 'puuid-abc';

const mockRiot = () => ({
  getAccount: jest.fn(),
  getAccountByPuuid: jest.fn(),
  getSummonerByPuuid: jest.fn(),
  getRankedStats: jest.fn().mockResolvedValue([]),
  getChampionMastery: jest.fn().mockResolvedValue([]),
  getChampionIdNameMap: jest.fn().mockResolvedValue(new Map()),
  getMatchHistory: jest.fn().mockResolvedValue([]),
  getMatch: jest.fn().mockResolvedValue(null),
  getMatchTimeline: jest.fn().mockResolvedValue(null),
  buildProfileIconUrl: jest.fn().mockReturnValue('https://example.com/icon.png'),
});

const mockAi = () => ({
  analyzePlayerProfile: jest.fn().mockResolvedValue({
    summary: 'Profile summary',
    fightPattern: 'Fight pattern',
    objectivePattern: 'Objective pattern',
    riskPattern: 'Risk pattern',
    mapPattern: 'Map pattern',
    tips: ['Tip'],
  }),
});

describe('PlayerStatsService', () => {
  let service: PlayerStatsService;
  let riot: ReturnType<typeof mockRiot>;
  let ai: ReturnType<typeof mockAi>;

  beforeEach(async () => {
    riot = mockRiot();
    ai = mockAi();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlayerStatsService,
        { provide: RiotService, useValue: riot },
        { provide: AiService, useValue: ai },
      ],
    }).compile();

    service = module.get<PlayerStatsService>(PlayerStatsService);
  });

  it('builds a single Riot player stats response without Clash team lookup', async () => {
    riot.getAccount.mockResolvedValue({ puuid: PUUID, gameName: 'Player', tagLine: 'BR1' });
    riot.getSummonerByPuuid.mockResolvedValue({ id: 'sid', puuid: PUUID, profileIconId: 123 });
    riot.getMatchHistory.mockImplementation((_puuid: string, _count: number, queue?: number) =>
      queue === 420 ? Promise.resolve(['m1', 'm2', 'm3']) : Promise.resolve([]),
    );
    riot.getMatch.mockImplementation((id: string) => {
      if (id === 'm1') return Promise.resolve({ info: { participants: [{ puuid: PUUID, win: true, kills: 5, deaths: 2, assists: 8, championId: 81, championName: 'Ezreal', teamPosition: 'BOTTOM' }] } });
      if (id === 'm2') return Promise.resolve({ info: { participants: [{ puuid: PUUID, win: true, kills: 7, deaths: 1, assists: 4, championId: 81, championName: 'Ezreal', teamPosition: 'BOTTOM' }] } });
      if (id === 'm3') return Promise.resolve({ info: { participants: [{ puuid: PUUID, win: false, kills: 2, deaths: 5, assists: 3, championId: 134, championName: 'Syndra', teamPosition: 'MIDDLE' }] } });
      return Promise.resolve(null);
    });

    const result = await service.getRiotPlayer('Player', 'BR1');

    expect(result.player.riotId).toBe('Player#BR1');
    expect(result.player.topPositions).toEqual(['ADC', 'MID']);
    expect(result.player.position).toBe('ADC');
    expect(result.player.soloQueue.games).toBe(3);
    expect(result.analysis.summary).toBe('Profile summary');
    expect(ai.analyzePlayerProfile).toHaveBeenCalledWith(result.player);
    expect(riot.getAccountByPuuid).not.toHaveBeenCalled();
  });

  it('keeps building stats when Riot ID lookup by PUUID fails', async () => {
    riot.getSummonerByPuuid.mockResolvedValue({ id: 'sid', puuid: PUUID, profileIconId: 123 });
    riot.getAccountByPuuid.mockResolvedValue(null);

    const result = await service.buildFromPuuid(PUUID, new Map());

    expect(result.riotId).toBe('Jogador#puui');
    expect(result.profileIconId).toBe(123);
  });

  it('keeps champion icons when Riot omits participant position but filters explicit offrole games', async () => {
    riot.getSummonerByPuuid.mockResolvedValue({ id: 'sid', puuid: PUUID, profileIconId: 123 });
    riot.getAccountByPuuid.mockResolvedValue({ gameName: 'Support', tagLine: 'BR1' });
    riot.getMatchHistory.mockImplementation((_puuid: string, _count: number, queue?: number) =>
      queue === 700 ? Promise.resolve(['unknown-role', 'offrole-adc']) : Promise.resolve([]),
    );
    riot.getMatch.mockImplementation((id: string) => {
      if (id === 'unknown-role') {
        return Promise.resolve({
          info: { participants: [{ puuid: PUUID, win: true, kills: 1, deaths: 2, assists: 12, championId: 412, championName: 'Thresh', teamPosition: '' }] },
        });
      }
      if (id === 'offrole-adc') {
        return Promise.resolve({
          info: { participants: [{ puuid: PUUID, win: false, kills: 8, deaths: 4, assists: 4, championId: 81, championName: 'Ezreal', teamPosition: 'BOTTOM' }] },
        });
      }
      return Promise.resolve(null);
    });

    const result = await service.buildFromPuuid(PUUID, new Map([[412, 'Thresh'], [81, 'Ezreal']]), 'UTILITY');

    expect(result.clashHistory.games).toBe(1);
    expect(result.clashHistory.topChampions.map((c) => c.championName)).toEqual(['Thresh']);
  });

  it('builds a collective profile only from Clash matches shared by the current core', async () => {
    const members = [
      { puuid: 'p1', riotId: 'Top#BR1' },
      { puuid: 'p2', riotId: 'Jungle#BR1' },
      { puuid: 'p3', riotId: 'Mid#BR1' },
    ];
    riot.getMatchHistory.mockResolvedValue(['shared', 'individual']);
    riot.getMatch.mockImplementation((id: string) => id === 'shared' ? Promise.resolve({
      info: {
        gameDuration: 1800,
        participants: [
          { puuid: 'p1', teamId: 100, win: true, kills: 5, deaths: 2, totalDamageDealtToChampions: 20_000 },
          { puuid: 'p2', teamId: 100, win: true, kills: 3, deaths: 3, totalDamageDealtToChampions: 10_000 },
          { puuid: 'p3', teamId: 100, win: true, kills: 7, deaths: 1, totalDamageDealtToChampions: 30_000 },
        ],
        teams: [{
          teamId: 100,
          win: true,
          objectives: {
            champion: { first: true }, tower: { first: true, kills: 8 },
            dragon: { kills: 3 }, baron: { kills: 1 },
          },
        }],
      },
    }) : Promise.resolve(null));

    const profile = await service.buildTeamTacticalProfile(members);

    expect(profile).toMatchObject({
      games: 1,
      winrate: 100,
      avgDurationMinutes: 30,
      avgKills: 15,
      avgDeaths: 6,
      avgDragons: 3,
      mainCarry: 'Mid#BR1',
      mainCarryDamageShare: 50,
      sampleConfidence: 'baixa',
      lineupPlayers: 3,
    });
  });

  it('does not label partial-roster matches as a collective lineup profile', async () => {
    const members = [
      { puuid: 'p1', riotId: 'Top#BR1' },
      { puuid: 'p2', riotId: 'Jungle#BR1' },
      { puuid: 'p3', riotId: 'Mid#BR1' },
      { puuid: 'p4', riotId: 'Adc#BR1' },
      { puuid: 'p5', riotId: 'Support#BR1' },
    ];
    riot.getMatchHistory.mockImplementation((puuid: string) =>
      Promise.resolve(puuid === 'p5' ? [] : ['partial-match']),
    );

    await expect(service.buildTeamTacticalProfile(members)).resolves.toBeUndefined();
    expect(riot.getMatch).not.toHaveBeenCalled();
  });

  it('groups nearby kill participations into pressure windows and avoids weak start-side claims', async () => {
    riot.getSummonerByPuuid.mockResolvedValue({ id: 'sid', puuid: PUUID, profileIconId: 123 });
    riot.getAccountByPuuid.mockResolvedValue({ gameName: 'Jungler', tagLine: 'BR1' });
    riot.getMatchHistory.mockImplementation((_puuid: string, _count: number, queue?: number) =>
      queue === 420 ? Promise.resolve(['m1']) : Promise.resolve([]),
    );
    riot.getMatch.mockResolvedValue({
      info: {
        participants: [{
          puuid: PUUID, teamId: 100, teamPosition: 'JUNGLE', win: true,
          kills: 4, deaths: 2, assists: 6, championId: 64, championName: 'LeeSin',
        }],
      },
    });
    riot.getMatchTimeline.mockResolvedValue({
      info: {
        participants: [{ puuid: PUUID, participantId: 1 }],
        frames: [
          { timestamp: 120_000, participantFrames: { '1': { position: { x: 3500, y: 7000 } } }, events: [] },
          { timestamp: 300_000, participantFrames: {}, events: [{ type: 'CHAMPION_KILL', timestamp: 300_000, killerId: 1, position: { x: 3000, y: 12000 } }] },
          { timestamp: 330_000, participantFrames: {}, events: [{ type: 'CHAMPION_KILL', timestamp: 330_000, assistingParticipantIds: [1], position: { x: 3000, y: 12000 } }] },
          { timestamp: 600_000, participantFrames: {}, events: [{ type: 'CHAMPION_KILL', timestamp: 600_000, killerId: 1, position: { x: 7500, y: 7500 } }] },
          { timestamp: 780_000, participantFrames: {}, events: [{ type: 'CHAMPION_KILL', timestamp: 780_000, killerId: 1, position: { x: 12000, y: 3000 } }] },
        ],
      },
    });

    const result = await service.buildFromPuuid(PUUID, new Map([[64, 'LeeSin']]), 'JUNGLE', undefined, true);

    expect(result.mapProfile).toMatchObject({
      games: 1,
      gankWindowsPerGame: 3,
      ganksByLane: { top: 1, mid: 1, bot: 1, total: 3 },
      gankPattern: 'distribuido',
      gankFocusShare: 33,
      firstGankFocus: 'inconclusivo',
      avgFirstGankMinute: 5,
      startSide: 'inconclusivo',
      startSideEvidenceGames: 1,
    });
  });
});
