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
        match({ id: 4, gameMode: GameMode.CLASSIC, won: true }),
        match({ id: 5, gameMode: GameMode.CLASSIC, won: false }),
      ] as any);

      const stats = await service.getPlayerDetailStats(serverId, userId);

      const aram = stats.gameModeStats.find((g) => g.gameMode === GameMode.ARAM)!;
      const classic = stats.gameModeStats.find((g) => g.gameMode === GameMode.CLASSIC)!;

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
        match({ id: 2, gameMode: GameMode.CLASSIC, won: true }),
      ] as any);

      const stats = await service.getPlayerDetailStats(serverId, userId);

      expect(stats.gameModeStats).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ gameMode: GameMode.ARAM, label: 'ARAM', mapName: 'Howling Abyss' }),
          expect.objectContaining({ gameMode: GameMode.CLASSIC, label: 'Clássico', mapName: "Summoner's Rift" }),
        ]),
      );
    });

    it('deve ordenar por número de partidas, do modo mais jogado para o menos', async () => {
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([
        match({ id: 1, gameMode: GameMode.CLASSIC, won: true }),
        match({ id: 2, gameMode: GameMode.ARAM, won: true }),
        match({ id: 3, gameMode: GameMode.ARAM, won: false }),
        match({ id: 4, gameMode: GameMode.ARAM, won: true }),
      ] as any);

      const stats = await service.getPlayerDetailStats(serverId, userId);

      expect(stats.gameModeStats.map((g) => g.gameMode)).toEqual([GameMode.ARAM, GameMode.CLASSIC]);
    });

    it('deve listar só os modos que o jogador realmente jogou', async () => {
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([
        match({ id: 1, gameMode: GameMode.CLASSIC, won: true }),
      ] as any);

      const stats = await service.getPlayerDetailStats(serverId, userId);

      expect(stats.gameModeStats).toHaveLength(1);
      expect(stats.gameModeStats[0].gameMode).toBe(GameMode.CLASSIC);
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
        match({ id: 2, gameMode: GameMode.CLASSIC, won: false, side: Side.RED }),
        match({ id: 3, gameMode: GameMode.CLASSIC, won: true, side: Side.RED }),
      ] as any);

      const stats = await service.getPlayerDetailStats(serverId, userId);

      const totalPorModo = stats.gameModeStats.reduce((acc, g) => acc + g.total, 0);
      const totalPorLado = stats.blueSide.total + stats.redSide.total;

      expect(totalPorModo).toBe(3);
      expect(totalPorModo).toBe(totalPorLado);
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
});
