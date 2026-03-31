import { Test, TestingModule } from '@nestjs/testing';
import { LeagueMatchService } from './leagueMatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordServerService } from '../discordServer/discordServer.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient, MatchStatus, MatchType, Side, Position } from '@prisma/client';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('LeagueMatchService', () => {
  let service: LeagueMatchService;
  let prismaMock: DeepMockProxy<PrismaClient>;
  let discordServiceMock: jest.Mocked<DiscordServerService>;

  beforeEach(async () => {
    prismaMock = mockDeep<PrismaClient>();
    discordServiceMock = {
      findOrCreate: jest.fn().mockResolvedValue({ id: 1, discordServerId: 'server-1' }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeagueMatchService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: DiscordServerService, useValue: discordServiceMock },
      ],
    }).compile();

    service = module.get<LeagueMatchService>(LeagueMatchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createOnline', () => {
    it('deve criar uma partida online com o status WAITING e matchFormat default', async () => {
      const dto = { discordServerId: 'server-1', creatorDiscordId: 'user-1' };
      const expectedMatch = { id: 1, status: MatchStatus.WAITING, matchType: MatchType.ALEATORIO };
      
      prismaMock.customLeagueMatch.create.mockResolvedValue(expectedMatch as any);

      const result = await service.createOnline(dto);

      expect(discordServiceMock.findOrCreate).toHaveBeenCalledWith('server-1');
      expect(prismaMock.customLeagueMatch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ServerDiscordId: 'server-1',
          creatorDiscordId: 'user-1',
          matchType: MatchType.ALEATORIO,
          status: MatchStatus.WAITING,
          expiresAt: expect.any(Date),
        }),
        include: expect.anything()
      });
      expect(result).toEqual(expectedMatch);
    });
  });

  describe('join', () => {
    const matchId = 1;
    const discordId = 'discord-1';
    const mockUser = { id: 10, discordId, name: 'Player1' };

    beforeEach(() => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      // Mock default findOne to return a simple WAITING match
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: matchId,
        status: MatchStatus.WAITING,
        queuePlayers: [],
      } as any);
      prismaMock.userTeamLeague.create.mockResolvedValue({ id: 99, matchId, userId: mockUser.id } as any);
    });

    it('deve adicionar um jogador na fila com sucesso', async () => {
      const result = await service.join(matchId, { discordId });

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { discordId } });
      expect(prismaMock.userTeamLeague.create).toHaveBeenCalledWith({
        data: { matchId: 1, userId: 10 }
      });
    });

    it('deve falhar se a partida não estiver WAITING', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ status: MatchStatus.STARTED } as any);
      
      await expect(service.join(matchId, { discordId })).rejects.toThrow(BadRequestException);
    });

    it('deve falhar se a fila já estiver cheia (10 jogadores)', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        status: MatchStatus.WAITING,
        queuePlayers: new Array(10).fill({}),
      } as any);
      
      await expect(service.join(matchId, { discordId })).rejects.toThrow('A partida já está cheia (10/10).');
    });

    it('deve falhar se o usuário já estiver na fila', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        status: MatchStatus.WAITING,
        queuePlayers: [{ userId: mockUser.id }],
      } as any);
      
      await expect(service.join(matchId, { discordId })).rejects.toThrow('Você já está na partida.');
    });
  });

  describe('leave', () => {
    const matchId = 1;
    const discordId = 'discord-1';
    const mockUser = { id: 10, discordId };

    beforeEach(() => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: matchId,
        status: MatchStatus.WAITING,
        queuePlayers: [{ id: 99, userId: mockUser.id }],
      } as any);
      prismaMock.userTeamLeague.delete.mockResolvedValue({ id: 99 } as any);
    });

    it('deve remover o jogador da fila com sucesso', async () => {
      await service.leave(matchId, discordId);

      expect(prismaMock.userTeamLeague.delete).toHaveBeenCalledWith({ where: { id: 99 } });
    });

    it('deve falhar se a partida não estiver WAITING', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ status: MatchStatus.STARTED } as any);
      await expect(service.leave(matchId, discordId)).rejects.toThrow(BadRequestException);
    });

    it('deve falhar se o jogador não estiver na fila', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        status: MatchStatus.WAITING,
        queuePlayers: [],
      } as any);
      await expect(service.leave(matchId, discordId)).rejects.toThrow('Você não está na partida.');
    });
  });

  describe('draw', () => {
    const matchId = 1;
    const creatorDiscordId = 'creator-1';
    
    // Gera 10 jogadores na fila
    const queuePlayers = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, userId: i + 1 }));

    beforeEach(() => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: matchId,
        status: MatchStatus.WAITING,
        creatorDiscordId,
        queuePlayers,
        matchType: MatchType.ALEATORIO,
      } as any);

      // Mocks for team creation
      prismaMock.teamLeague.create.mockResolvedValueOnce({ id: 10, side: Side.BLUE } as any);
      prismaMock.teamLeague.create.mockResolvedValueOnce({ id: 20, side: Side.RED } as any);
      
      prismaMock.userTeamLeague.updateMany.mockResolvedValue({ count: 5 } as any);
      prismaMock.customLeagueMatch.update.mockResolvedValue({ id: matchId } as any);
    });

    it('deve sortear 10 jogadores em dois times', async () => {
      await service.draw(matchId, creatorDiscordId);

      expect(prismaMock.teamLeague.create).toHaveBeenCalledTimes(2);
      expect(prismaMock.userTeamLeague.updateMany).toHaveBeenCalledTimes(2); // Blue update, Red update
      expect(prismaMock.customLeagueMatch.update).toHaveBeenCalledWith({
        where: { id: matchId },
        data: expect.objectContaining({
          teamBlueId: 10,
          teamRedId: 20,
        })
      });
    });

    it('deve falhar se não for o criador', async () => {
      await expect(service.draw(matchId, 'other-id')).rejects.toThrow(ForbiddenException);
    });

    it('deve falhar se a partida não for WAITING', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        status: MatchStatus.STARTED, creatorDiscordId
      } as any);
      await expect(service.draw(matchId, creatorDiscordId)).rejects.toThrow(BadRequestException);
    });

    it('deve limpar os times se já houver um sorteio prévio (re-sorteio)', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: matchId,
        status: MatchStatus.WAITING,
        creatorDiscordId,
        queuePlayers,
        matchType: MatchType.ALEATORIO,
        teamBlueId: 10,
        teamRedId: 20,
      } as any);

      prismaMock.teamLeague.deleteMany.mockResolvedValue({ count: 2 } as any);
      
      await service.draw(matchId, creatorDiscordId);

      // Deve ter apagado os times velhos
      expect(prismaMock.userTeamLeague.updateMany).toHaveBeenCalledWith({
        where: { matchId },
        data: { teamLeagueId: null, position: null }
      });
      expect(prismaMock.teamLeague.deleteMany).toHaveBeenCalled();
    });

    it('deve distribuir posições se o tipo for ALEATORIO_COMPLETO', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: matchId,
        status: MatchStatus.WAITING,
        creatorDiscordId,
        queuePlayers,
        matchType: MatchType.ALEATORIO_COMPLETO,
      } as any);

      prismaMock.userTeamLeague.update.mockResolvedValue({} as any);

      await service.draw(matchId, creatorDiscordId);

      // Em vez de updateMany, ele faz 10 updates isolados com posições
      expect(prismaMock.userTeamLeague.update).toHaveBeenCalledTimes(10);
      expect(prismaMock.customLeagueMatch.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ showDetails: true }) })
      );
    });
  });

  describe('start', () => {
    const matchId = 1;
    const creatorDiscordId = 'creator-1';
    
    it('deve iniciar a partida se houver 10 jogadores divididos em 2 times de 5', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: matchId,
        status: MatchStatus.WAITING,
        creatorDiscordId,
        queuePlayers: new Array(10).fill({}),
        teamBlueId: 10,
        teamRedId: 20,
        Teams: [
          { id: 10, players: new Array(5).fill({}) },
          { id: 20, players: new Array(5).fill({}) }
        ]
      } as any);

      prismaMock.customLeagueMatch.update.mockResolvedValue({ id: matchId, status: MatchStatus.STARTED } as any);

      const result = await service.start(matchId, creatorDiscordId);

      expect(prismaMock.customLeagueMatch.update).toHaveBeenCalledWith({
        where: { id: matchId },
        data: expect.objectContaining({ status: MatchStatus.STARTED, startedAt: expect.any(Date) }),
        include: expect.anything()
      });
    });

    it('deve lançar erro se os times não estiverem sorteados', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: matchId,
        status: MatchStatus.WAITING,
        creatorDiscordId,
        queuePlayers: new Array(10).fill({}),
        Teams: [] // Times vazios
      } as any);

      await expect(service.start(matchId, creatorDiscordId)).rejects.toThrow('Sorteie os times antes de iniciar.');
    });

    it('se o modo for LIVRE, deve sortear sozinhos os 10 players presentes caso ninguem tenha sorteado', async () => {
      const queuePlayers = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i }));
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: matchId,
        status: MatchStatus.WAITING,
        matchType: MatchType.LIVRE,
        creatorDiscordId,
        queuePlayers,
        Teams: [] 
      } as any);

      prismaMock.teamLeague.create.mockResolvedValueOnce({ id: 10, side: Side.BLUE } as any);
      prismaMock.teamLeague.create.mockResolvedValueOnce({ id: 20, side: Side.RED } as any);
      prismaMock.userTeamLeague.updateMany.mockResolvedValue({ count: 5 } as any);
      prismaMock.customLeagueMatch.update.mockResolvedValue({ id: matchId } as any);

      await service.start(matchId, creatorDiscordId);

      // Verificamos que times foram criados na hora do start
      expect(prismaMock.teamLeague.create).toHaveBeenCalledTimes(2);
      expect(prismaMock.customLeagueMatch.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: MatchStatus.STARTED }) })
      );
    });
  });

  describe('finish', () => {
    const matchId = 1;
    const creatorDiscordId = 'creator-1';

    it('deve finalizar a partida com sucesso e definir o winnerId correspondente ao time vermelho', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: matchId,
        status: MatchStatus.STARTED,
        creatorDiscordId,
        teamBlueId: 10,
        teamRedId: 20,
      } as any);

      prismaMock.customLeagueMatch.update.mockResolvedValue({ id: matchId } as any);

      await service.finish(matchId, creatorDiscordId, Side.RED);

      expect(prismaMock.customLeagueMatch.update).toHaveBeenCalledWith({
        where: { id: matchId },
        data: expect.objectContaining({ status: MatchStatus.FINISHED, winnerId: 20 }),
        include: expect.anything()
      });
    });

    it('deve falhar se partida não estiver STARTED', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ status: MatchStatus.WAITING, creatorDiscordId } as any);
      await expect(service.finish(matchId, creatorDiscordId, Side.RED)).rejects.toThrow(BadRequestException);
    });
  });

  describe('cron: cleanExpiredLobbies', () => {
    it('deve atualizar partidas expiradas para o status EXPIRED', async () => {
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }] as any);
      prismaMock.customLeagueMatch.updateMany.mockResolvedValue({ count: 2 } as any);

      await service.cleanExpiredLobbies();

      expect(prismaMock.customLeagueMatch.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ expiresAt: { lt: expect.any(Date) } })
      }));
      expect(prismaMock.customLeagueMatch.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] } },
        data: { status: MatchStatus.EXPIRED },
      });
    });

    it('não deve fazer nada se não houver lobbies expirados', async () => {
      prismaMock.customLeagueMatch.findMany.mockResolvedValue([]);
      
      await service.cleanExpiredLobbies();
      
      expect(prismaMock.customLeagueMatch.updateMany).not.toHaveBeenCalled();
    });
  });
});
