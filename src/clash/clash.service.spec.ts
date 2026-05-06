import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ClashService } from './clash.service';
import { RiotService } from '../riot/riot.service';
import { AiService } from '../ai/ai.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const GAME_NAME = 'TestPlayer';
const TAG_LINE  = 'BR1';
const PUUID     = 'puuid-abc';
const TEAM_ID   = 'team-xyz';

const ACCOUNT = { puuid: PUUID, gameName: GAME_NAME, tagLine: TAG_LINE };

const TEAM_DTO = {
  id: TEAM_ID,
  tournamentId: 100,
  name: 'Test Team',
  iconId: 1,
  tier: 2,
  abbreviation: 'TT',
  players: [
    { puuid: 'p1', position: 'TOP',     role: 'CAPTAIN' },
    { puuid: 'p2', position: 'JUNGLE',  role: 'MEMBER' },
    { puuid: 'p3', position: 'MIDDLE',  role: 'MEMBER' },
    { puuid: 'p4', position: 'BOTTOM',  role: 'MEMBER' },
    { puuid: 'p5', position: 'UTILITY', role: 'MEMBER' },
  ],
};

const makeSummoner = (puuid: string) => ({
  id: `sid-${puuid}`,
  puuid,
  profileIconId: 1234,
  summonerLevel: 100,
});

const makeAccount = (puuid: string, idx: number) => ({
  puuid,
  gameName: `Player${idx}`,
  tagLine: 'BR1',
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRiot = () => ({
  getAccount: jest.fn(),
  getClashPlayersByPuuid: jest.fn(),
  getClashTeam: jest.fn(),
  getAccountByPuuid: jest.fn(),
  getSummonerByPuuid: jest.fn(),
  getSummonerById: jest.fn(),
  getRankedStats: jest.fn().mockResolvedValue([]),
  getChampionMastery: jest.fn().mockResolvedValue([]),
  getMatchHistory: jest.fn().mockResolvedValue([]),
  getMatch: jest.fn().mockResolvedValue(null),
  getChampionIdNameMap: jest.fn().mockResolvedValue(new Map()),
  buildProfileIconUrl: jest.fn().mockReturnValue('https://example.com/icon.png'),
});

const mockAi = () => ({
  analyzeOpponents: jest.fn().mockResolvedValue({
    bans: [{ championId: 1, championName: 'Annie', targetPlayer: 'Player1#BR1', reason: 'High WR', priority: 1 }],
    counterplays: [],
    predictedPicks: [],
    strategy: 'Poke and objective control.',
  }),
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('ClashService', () => {
  let service: ClashService;
  let riot: ReturnType<typeof mockRiot>;
  let ai: ReturnType<typeof mockAi>;

  beforeEach(async () => {
    riot = mockRiot();
    ai = mockAi();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClashService,
        { provide: RiotService, useValue: riot },
        { provide: AiService, useValue: ai },
      ],
    }).compile();

    service = module.get<ClashService>(ClashService);
  });

  // ─── scout ────────────────────────────────────────────────────────────────

  describe('scout', () => {
    const setupHappy = () => {
      riot.getAccount.mockResolvedValue(ACCOUNT);
      riot.getClashPlayersByPuuid.mockResolvedValue([{ puuid: PUUID, teamId: TEAM_ID, position: 'TOP', role: 'CAPTAIN' }]);
      riot.getClashTeam.mockResolvedValue(TEAM_DTO);
      riot.getSummonerByPuuid.mockImplementation((puuid: string) => Promise.resolve(makeSummoner(puuid)));
      riot.getAccountByPuuid.mockImplementation((puuid: string) =>
        Promise.resolve(makeAccount(puuid, TEAM_DTO.players.findIndex((p) => p.puuid === puuid) + 1)),
      );
    };

    it('throws BadRequestException when player is not registered in any clash team', async () => {
      riot.getAccount.mockResolvedValue(ACCOUNT);
      riot.getClashPlayersByPuuid.mockResolvedValue([]);

      await expect(service.scout(GAME_NAME, TAG_LINE)).rejects.toThrow(BadRequestException);
    });

    it('resolves account by gameName+tagLine then finds their clash team', async () => {
      setupHappy();

      await service.scout(GAME_NAME, TAG_LINE);

      expect(riot.getAccount).toHaveBeenCalledWith(GAME_NAME, TAG_LINE);
      expect(riot.getClashPlayersByPuuid).toHaveBeenCalledWith(PUUID);
      expect(riot.getClashTeam).toHaveBeenCalledWith(TEAM_ID);
    });

    it('returns team metadata', async () => {
      setupHappy();

      const result = await service.scout(GAME_NAME, TAG_LINE);

      expect(result.team).toMatchObject({
        id: TEAM_ID,
        name: 'Test Team',
        abbreviation: 'TT',
        tier: 2,
      });
    });

    it('returns 5 processed players', async () => {
      setupHappy();

      const result = await service.scout(GAME_NAME, TAG_LINE);

      expect(result.players).toHaveLength(5);
    });

    it('uses getSummonerByPuuid — TeamDto.PlayerDto has puuid, not summonerId', async () => {
      setupHappy();

      await service.scout(GAME_NAME, TAG_LINE);

      expect(riot.getSummonerByPuuid).toHaveBeenCalledWith('p1');
      expect(riot.getSummonerByPuuid).toHaveBeenCalledWith('p2');
      expect(riot.getSummonerById).not.toHaveBeenCalled();
    });

    it('passes puuid to getRankedStats — league/v4/entries/by-puuid is the available endpoint', async () => {
      setupHappy();

      await service.scout(GAME_NAME, TAG_LINE);

      expect(riot.getRankedStats).toHaveBeenCalledWith('p1');
      expect(riot.getRankedStats).toHaveBeenCalledWith('p2');
      expect(riot.getRankedStats).not.toHaveBeenCalledWith('sid-p1');
    });

    it('fetches match history with correct queue IDs: 420 solo, 440 flex, 700 clash', async () => {
      setupHappy();

      await service.scout(GAME_NAME, TAG_LINE);

      TEAM_DTO.players.forEach(({ puuid }) => {
        expect(riot.getMatchHistory).toHaveBeenCalledWith(puuid, 20, 420);
        expect(riot.getMatchHistory).toHaveBeenCalledWith(puuid, 10, 440);
        expect(riot.getMatchHistory).toHaveBeenCalledWith(puuid, 10, 700);
      });
    });

    it('normalizes API positions correctly', async () => {
      setupHappy();

      const result = await service.scout(GAME_NAME, TAG_LINE);
      const positions = result.players.map((p: any) => p.position);

      expect(positions).toContain('TOP');
      expect(positions).toContain('JUNGLE');
      expect(positions).toContain('MID');     // MIDDLE → MID
      expect(positions).toContain('ADC');     // BOTTOM → ADC
      expect(positions).toContain('SUPPORT'); // UTILITY → SUPPORT
    });

    it('includes AI analysis in result', async () => {
      setupHappy();

      const result = await service.scout(GAME_NAME, TAG_LINE);

      expect(ai.analyzeOpponents).toHaveBeenCalled();
      expect(result.bans).toHaveLength(1);
      expect(result.strategy).toBe('Poke and objective control.');
    });

    it('returns partial results when individual player lookup fails', async () => {
      setupHappy();
      let calls = 0;
      riot.getSummonerByPuuid.mockImplementation((puuid: string) => {
        calls++;
        if (calls === 2) return Promise.reject(new Error('not found'));
        return Promise.resolve(makeSummoner(puuid));
      });

      const result = await service.scout(GAME_NAME, TAG_LINE);

      expect(result.players).toHaveLength(4);
      expect(result.team.name).toBe('Test Team');
    });

    it('returns empty AI fields gracefully when AI service throws', async () => {
      setupHappy();
      ai.analyzeOpponents.mockRejectedValue(new Error('timeout'));

      const result = await service.scout(GAME_NAME, TAG_LINE);

      expect(result.bans).toEqual([]);
      expect(result.strategy).toBe('');
    });

    it('no PrismaService dependency — does not require account verification', async () => {
      setupHappy();

      // Service must work without any prisma calls
      // If PrismaService were injected it would error on module creation
      await expect(service.scout(GAME_NAME, TAG_LINE)).resolves.toBeDefined();
    });

    describe('position normalization', () => {
      const cases: [string, string][] = [
        ['TOP', 'TOP'],
        ['JUNGLE', 'JUNGLE'],
        ['MIDDLE', 'MID'],
        ['MID', 'MID'],
        ['BOTTOM', 'ADC'],
        ['BOT', 'ADC'],
        ['UTILITY', 'SUPPORT'],
        ['SUPPORT', 'SUPPORT'],
        ['FILL', 'FILL'],
        ['UNSELECTED', 'FILL'],
      ];

      it.each(cases)('maps API position %s → %s', async (apiPos, expected) => {
        riot.getAccount.mockResolvedValue(ACCOUNT);
        riot.getClashPlayersByPuuid.mockResolvedValue([{ puuid: PUUID, teamId: TEAM_ID }]);
        riot.getClashTeam.mockResolvedValue({
          ...TEAM_DTO,
          players: [{ puuid: 'p1', position: apiPos, role: 'CAPTAIN' }],
        });
        riot.getSummonerByPuuid.mockResolvedValue(makeSummoner('p1'));
        riot.getAccountByPuuid.mockResolvedValue(makeAccount('p1', 1));

        const result = await service.scout(GAME_NAME, TAG_LINE);

        expect(result.players[0].position).toBe(expected);
      });
    });

    describe('stats aggregation', () => {
      const setupOnePlayer = () => {
        riot.getAccount.mockResolvedValue(ACCOUNT);
        riot.getClashPlayersByPuuid.mockResolvedValue([{ puuid: PUUID, teamId: TEAM_ID }]);
        riot.getClashTeam.mockResolvedValue({ ...TEAM_DTO, players: [{ puuid: 'p1', position: 'TOP', role: 'CAPTAIN' }] });
        riot.getSummonerByPuuid.mockResolvedValue(makeSummoner('p1'));
        riot.getAccountByPuuid.mockResolvedValue(makeAccount('p1', 1));
        riot.getChampionMastery.mockResolvedValue([]);
      };

      const makeParticipant = (puuid: string, win: boolean, k: number, d: number, a: number, champId: number, champName: string) => ({
        info: { participants: [{ puuid, win, kills: k, deaths: d, assists: a, championId: champId, championName: champName }] },
      });

      it('calculates winrate and KDA from match data', async () => {
        setupOnePlayer();
        riot.getRankedStats.mockResolvedValue([]);
        riot.getMatchHistory.mockImplementation((_puuid: string, _count: number, queue?: number) =>
          queue === 420 ? Promise.resolve(['m1', 'm2', 'm3']) : Promise.resolve([]),
        );
        riot.getMatch.mockImplementation((id: string) => {
          const pu = 'p1';
          if (id === 'm1') return Promise.resolve(makeParticipant(pu, true,  5, 2, 8, 81, 'Ezreal'));
          if (id === 'm2') return Promise.resolve(makeParticipant(pu, true,  7, 1, 4, 81, 'Ezreal'));
          if (id === 'm3') return Promise.resolve(makeParticipant(pu, false, 2, 5, 3, 81, 'Ezreal'));
          return Promise.resolve(null);
        });

        const result = await service.scout(GAME_NAME, TAG_LINE);
        const p = result.players[0];

        expect(p.soloQueue.games).toBe(3);
        expect(p.soloQueue.winrate).toBe(67); // 2/3 → 67%
        expect(p.soloQueue.avgKda).toBe(3.6); // (5+8+7+4+2+3)/(2+1+5) = 29/8 → 3.6
      });

      it('reads season winrate from ranked stats', async () => {
        setupOnePlayer();
        riot.getRankedStats.mockResolvedValue([{
          queueType: 'RANKED_SOLO_5x5',
          tier: 'GOLD', rank: 'II', leaguePoints: 50,
          wins: 80, losses: 70,
        }]);
        riot.getMatchHistory.mockResolvedValue([]);

        const result = await service.scout(GAME_NAME, TAG_LINE);
        const p = result.players[0];

        expect(p.soloRank.tier).toBe('GOLD');
        expect(p.soloSeasonWinrate).toBe(53); // 80/(80+70) → 53%
      });

      it('combined top champs weights: solo 60%, flex 25%, clash 15%', async () => {
        setupOnePlayer();
        riot.getRankedStats.mockResolvedValue([]);
        riot.getMatchHistory.mockImplementation((_puuid: string, _count: number, queue?: number) => {
          if (queue === 420) return Promise.resolve(['s1', 's2', 's3']); // 3 solo
          if (queue === 700) return Promise.resolve(['c1']);              // 1 clash
          return Promise.resolve([]);
        });
        riot.getMatch.mockImplementation((id: string) => {
          const pu = 'p1';
          if (id.startsWith('s')) return Promise.resolve(makeParticipant(pu, true, 5, 2, 3, 81, 'Ezreal'));
          if (id === 'c1')        return Promise.resolve(makeParticipant(pu, true, 3, 1, 5, 412, 'Thresh'));
          return Promise.resolve(null);
        });

        const result = await service.scout(GAME_NAME, TAG_LINE);
        const combined = result.players[0].combinedTopChamps;

        // Ezreal: 3*0.6=1.8 > Thresh: 1*0.15=0.15 → Ezreal first
        expect(combined[0].championName).toBe('Ezreal');
        expect(combined[1].championName).toBe('Thresh');
      });
    });
  });
});
