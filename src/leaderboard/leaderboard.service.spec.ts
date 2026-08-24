import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient, GameMode, MatchType, Side } from '@prisma/client';
import { LeaderboardService } from './leaderboard.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LeaderboardService', () => {
  let service: LeaderboardService;
  let prismaMock: DeepMockProxy<PrismaClient>;

  const serverId = 'server-1';
  const userId = 42;

  /**
   * Monta uma partida como o Prisma devolve em getPlayerDetailStats: o include
   * filtra `players` por userId, então só o time do jogador vem com jogadores.
   */
  const match = (opts: {
    id: number;
    gameMode: GameMode;
    won: boolean;
    side?: Side;
    position?: string | null;
    date?: Date;
  }) => {
    const playerTeamId = 100 + opts.id;
    return {
      id: opts.id,
      gameMode: opts.gameMode,
      matchType: MatchType.ALEATORIO,
      playersPerTeam: 5,
      dateCreated: opts.date ?? new Date('2026-07-20T12:00:00Z'),
      winnerId: opts.won ? playerTeamId : 999,
      Teams: [
        {
          id: playerTeamId,
          side: opts.side ?? Side.BLUE,
          players: [{ userId, position: opts.position ?? null }],
        },
      ],
    };
  };

  beforeEach(async () => {
    prismaMock = mockDeep<PrismaClient>();
    prismaMock.season.findFirst.mockResolvedValue(null as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [LeaderboardService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<LeaderboardService>(LeaderboardService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPlayerDetailStats › gameModeStats', () => {
    it('deve separar vitórias e derrotas por modo de jogo', async () => {
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([
        match({ id: 1, gameMode: GameMode.ARAM, won: true }),
        match({ id: 2, gameMode: GameMode.ARAM, won: true }),
        match({ id: 3, gameMode: GameMode.ARAM, won: false }),
        match({ id: 4, gameMode: GameMode.SUMMONERS_RIFT, won: true }),
        match({ id: 5, gameMode: GameMode.SUMMONERS_RIFT, won: false }),
      ] as any);

      const stats = await service.getPlayerDetailStats(serverId, userId);

      const aram = stats.gameModeStats.find((g) => g.gameMode === GameMode.ARAM)!;
      const classic = stats.gameModeStats.find((g) => g.gameMode === GameMode.SUMMONERS_RIFT)!;

      expect(aram).toEqual(
        expect.objectContaining({ wins: 2, losses: 1, total: 3, winRate: 0.67 }),
      );
      expect(classic).toEqual(
        expect.objectContaining({ wins: 1, losses: 1, total: 2, winRate: 0.5 }),
      );
    });

    it('deve trazer o label e o nome do mapa de cada modo', async () => {
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([
        match({ id: 1, gameMode: GameMode.ARAM, won: true }),
        match({ id: 2, gameMode: GameMode.SUMMONERS_RIFT, won: true }),
      ] as any);

      const stats = await service.getPlayerDetailStats(serverId, userId);

      expect(stats.gameModeStats).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ gameMode: GameMode.ARAM, label: 'ARAM', mapName: 'Howling Abyss' }),
          expect.objectContaining({ gameMode: GameMode.SUMMONERS_RIFT, label: 'Normal', mapName: "Summoner's Rift" }),
        ]),
      );
    });

    it('deve ordenar por número de partidas, do modo mais jogado para o menos', async () => {
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([
        match({ id: 1, gameMode: GameMode.SUMMONERS_RIFT, won: true }),
        match({ id: 2, gameMode: GameMode.ARAM, won: true }),
        match({ id: 3, gameMode: GameMode.ARAM, won: false }),
        match({ id: 4, gameMode: GameMode.ARAM, won: true }),
      ] as any);

      const stats = await service.getPlayerDetailStats(serverId, userId);

      expect(stats.gameModeStats.map((g) => g.gameMode)).toEqual([GameMode.ARAM, GameMode.SUMMONERS_RIFT]);
    });

    it('deve listar só os modos que o jogador realmente jogou', async () => {
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([
        match({ id: 1, gameMode: GameMode.SUMMONERS_RIFT, won: true }),
      ] as any);

      const stats = await service.getPlayerDetailStats(serverId, userId);

      expect(stats.gameModeStats).toHaveLength(1);
      expect(stats.gameModeStats[0].gameMode).toBe(GameMode.SUMMONERS_RIFT);
    });

    it('deve devolver lista vazia quando não há partidas', async () => {
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([] as any);

      const stats = await service.getPlayerDetailStats(serverId, userId);

      expect(stats.gameModeStats).toEqual([]);
    });

    it('deve contar 100% quando o jogador venceu todas do modo', async () => {
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([
        match({ id: 1, gameMode: GameMode.ARAM, won: true }),
        match({ id: 2, gameMode: GameMode.ARAM, won: true }),
      ] as any);

      const stats = await service.getPlayerDetailStats(serverId, userId);

      expect(stats.gameModeStats[0]).toEqual(
        expect.objectContaining({ wins: 2, losses: 0, winRate: 1 }),
      );
    });

    it('deve contar 0% quando o jogador perdeu todas do modo', async () => {
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([
        match({ id: 1, gameMode: GameMode.ARAM, won: false }),
        match({ id: 2, gameMode: GameMode.ARAM, won: false }),
      ] as any);

      const stats = await service.getPlayerDetailStats(serverId, userId);

      expect(stats.gameModeStats[0]).toEqual(
        expect.objectContaining({ wins: 0, losses: 2, winRate: 0 }),
      );
    });

    it('deve bater com o total geral de partidas do jogador', async () => {
      // Invariante: somar os totais por modo tem que dar o total de partidas,
      // senão alguma partida sumiu ou foi contada duas vezes na agregação.
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([
        match({ id: 1, gameMode: GameMode.ARAM, won: true, side: Side.BLUE }),
        match({ id: 2, gameMode: GameMode.SUMMONERS_RIFT, won: false, side: Side.RED }),
        match({ id: 3, gameMode: GameMode.SUMMONERS_RIFT, won: true, side: Side.RED }),
      ] as any);

      const stats = await service.getPlayerDetailStats(serverId, userId);

      const totalPorModo = stats.gameModeStats.reduce((acc, g) => acc + g.total, 0);
      const totalPorLado = stats.blueSide.total + stats.redSide.total;

      expect(totalPorModo).toBe(3);
      expect(totalPorModo).toBe(totalPorLado);
    });
  });

  describe('getLeaderboardForServer › filtro de mapa', () => {
    beforeEach(() => {
      (prismaMock.$queryRaw as any).mockResolvedValue([]);
    });

    /**
     * $queryRaw é tagged template: recebe (strings, ...values). Os filtros
     * opcionais entram como fragmentos Prisma.sql aninhados nos values, então
     * é preciso achatar tudo para inspecionar o SQL e os parâmetros ligados.
     */
    const rawCall = () => {
      const [strings, ...values] = (prismaMock.$queryRaw as any).mock.calls[0];
      const parts: string[] = [...(strings ?? [])];
      const bound: unknown[] = [];
      const walk = (value: any) => {
        if (value && typeof value === 'object' && Array.isArray(value.strings)) {
          parts.push(...value.strings);
          (value.values ?? []).forEach(walk);
        } else {
          bound.push(value);
        }
      };
      values.forEach(walk);
      return { text: parts.join(' '), bound };
    };

    it('não deve filtrar por mapa quando o gameMode é omitido (geral)', async () => {
      await service.getLeaderboardForServer(serverId);

      expect(rawCall().text).not.toContain('"gameMode"');
    });

    it('deve filtrar por mapa quando o gameMode é informado', async () => {
      await service.getLeaderboardForServer(serverId, undefined, GameMode.ARAM);

      const { text, bound } = rawCall();
      expect(text).toContain('"gameMode"');
      expect(bound).toContain(GameMode.ARAM);
    });

    it('deve combinar filtro de mapa e de tamanho de time', async () => {
      await service.getLeaderboardForServer(serverId, 5, GameMode.LOL_CLASSIC);

      const { text, bound } = rawCall();
      expect(text).toContain('"gameMode"');
      expect(text).toContain('"playersPerTeam"');
      expect(bound).toEqual(expect.arrayContaining([GameMode.LOL_CLASSIC, 5]));
    });

    it('deve usar caches separados por mapa', async () => {
      // Sem isso, escolher ARAM devolveria o ranking do Summoner's Rift.
      await service.getLeaderboardForServer(serverId, 5, GameMode.SUMMONERS_RIFT);
      await service.getLeaderboardForServer(serverId, 5, GameMode.ARAM);

      expect((prismaMock.$queryRaw as any)).toHaveBeenCalledTimes(2);
    });

    it('deve reaproveitar o cache no mesmo recorte', async () => {
      await service.getLeaderboardForServer(serverId, 5, GameMode.ARAM);
      await service.getLeaderboardForServer(serverId, 5, GameMode.ARAM);

      expect((prismaMock.$queryRaw as any)).toHaveBeenCalledTimes(1);
    });

    it('deve separar o cache do geral do cache de um mapa específico', async () => {
      await service.getLeaderboardForServer(serverId);
      await service.getLeaderboardForServer(serverId, undefined, GameMode.SUMMONERS_RIFT);

      expect((prismaMock.$queryRaw as any)).toHaveBeenCalledTimes(2);
    });

    it('deve devolver a quantidade de MVPs do jogador', async () => {
      (prismaMock.$queryRaw as any).mockResolvedValue([
        {
          userId,
          name: 'Jogador',
          discordId: 'discord-42',
          avatar: null,
          wins: 3,
          losses: 1,
          totalGames: 4,
          mvpCount: 2,
          score: 80,
        },
      ]);

      const [player] = await service.getLeaderboardForServer(serverId);

      expect(player.mvpCount).toBe(2);
    });

    it('deve usar a quantidade de MVPs como primeiro desempate após o score', async () => {
      await service.getLeaderboardForServer(serverId);

      const { text } = rawCall();
      const scoreOrder = text.indexOf('score DESC');
      const mvpOrder = text.indexOf('prs."mvpCount" DESC');
      const winsOrder = text.indexOf('wins DESC');

      expect(scoreOrder).toBeGreaterThan(-1);
      expect(mvpOrder).toBeGreaterThan(scoreOrder);
      expect(winsOrder).toBeGreaterThan(mvpOrder);
    });
  });

  describe('getPlayerDetailStats › cache', () => {
    it('não deve reconsultar o banco na segunda chamada', async () => {
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([
        match({ id: 1, gameMode: GameMode.ARAM, won: true }),
      ] as any);

      await service.getPlayerDetailStats(serverId, userId);
      await service.getPlayerDetailStats(serverId, userId);

      expect(prismaMock.customLeagueMatch.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('getMatchHistoryForServer pagination', () => {
    const historyMatch = {
      id: 7,
      gameMode: GameMode.SUMMONERS_RIFT,
      matchType: MatchType.ALEATORIO,
      playersPerTeam: 5,
      dateCreated: new Date('2026-08-20T12:00:00Z'),
      winnerId: null,
      Teams: [],
    };

    it('fetches only the requested database page', async () => {
      prismaMock.customLeagueMatch.count.mockResolvedValue(42);
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([historyMatch] as any);

      const result = await service.getMatchHistoryForServer(serverId, undefined, 2, 5);

      expect(prismaMock.customLeagueMatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, skip: 5 }),
      );
      expect(result).toEqual(expect.objectContaining({ total: 42, page: 2, pages: 9, hasNext: true }));
      expect(result.data).toHaveLength(1);
    });

    it('reuses the cache for the same page', async () => {
      prismaMock.customLeagueMatch.count.mockResolvedValue(1);
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([historyMatch] as any);

      await service.getMatchHistoryForServer(serverId, undefined, 1, 5);
      await service.getMatchHistoryForServer(serverId, undefined, 1, 5);

      expect(prismaMock.customLeagueMatch.count).toHaveBeenCalledTimes(1);
      expect(prismaMock.customLeagueMatch.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
