import { Test, TestingModule } from '@nestjs/testing';
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
  buildProfileIconUrl: jest.fn().mockReturnValue('https://example.com/icon.png'),
});

describe('PlayerStatsService', () => {
  let service: PlayerStatsService;
  let riot: ReturnType<typeof mockRiot>;

  beforeEach(async () => {
    riot = mockRiot();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlayerStatsService,
        { provide: RiotService, useValue: riot },
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
    expect(riot.getAccountByPuuid).not.toHaveBeenCalled();
  });

  it('keeps building stats when Riot ID lookup by PUUID fails', async () => {
    riot.getSummonerByPuuid.mockResolvedValue({ id: 'sid', puuid: PUUID, profileIconId: 123 });
    riot.getAccountByPuuid.mockRejectedValue(new Error('not found'));

    const result = await service.buildFromPuuid(PUUID, new Map());

    expect(result.riotId).toBe('Jogador#puuid-');
    expect(result.profileIconId).toBe(123);
  });
});
