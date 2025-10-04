import { Test, TestingModule } from '@nestjs/testing';
import { LeagueMatchService } from './leagueMatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

describe('LeagueMatchService', () => {
  let service: LeagueMatchService;

  const mockPrismaService = {
    $transaction: jest.fn(),
    customLeagueMatch: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    teamLeague: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeagueMatchService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<LeagueMatchService>(LeagueMatchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new league match', async () => {
      const createLeagueMatchDto = {
        riotMatchId: 'BR1_12345',
        teamBlue: {
          players: [{ userId: 1 }, { userId: 2 }],
        },
        teamRed: {
          players: [{ userId: 3 }, { userId: 4 }],
        },
        ServerDiscordId: 'server123',
      };

      const mockTeamBlue = { id: 1 };
      const mockTeamRed = { id: 2 };
      const mockLeagueMatch = {
        id: 1,
        winnerId: null,
        ServerDiscordId: 'server123',
        Teams: [mockTeamBlue, mockTeamRed],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });

      mockPrismaService.teamLeague.create
        .mockResolvedValueOnce(mockTeamBlue)
        .mockResolvedValueOnce(mockTeamRed);

      mockPrismaService.customLeagueMatch.create.mockResolvedValue(
        mockLeagueMatch,
      );

      const result = await service.create(createLeagueMatchDto);

      expect(result).toEqual(mockLeagueMatch);
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.teamLeague.create).toHaveBeenCalledTimes(2);
      expect(mockPrismaService.customLeagueMatch.create).toHaveBeenCalledTimes(
        1,
      );
    });

    it('should throw BadRequestException if match already exists', async () => {
      const createLeagueMatchDto = {
        riotMatchId: 'BR1_12345',
        teamBlue: {
          players: [{ userId: 1 }],
        },
        teamRed: {
          players: [{ userId: 2 }],
        },
        ServerDiscordId: 'server123',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2002',
        clientVersion: '',
      });

      mockPrismaService.teamLeague.create.mockRejectedValue(prismaError);

      await expect(service.create(createLeagueMatchDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if user not found', async () => {
      const createLeagueMatchDto = {
        riotMatchId: 'BR1_12345',
        teamBlue: {
          players: [{ userId: 1 }],
        },
        teamRed: {
          players: [{ userId: 2 }],
        },
        ServerDiscordId: 'server123',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2003',
        clientVersion: '',
      });

      mockPrismaService.teamLeague.create.mockRejectedValue(prismaError);

      await expect(service.create(createLeagueMatchDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    it('should return all league matches', async () => {
      const mockMatches = [
        {
          id: 1,
          winnerId: null,
          ServerDiscordId: 'server123',
          Teams: [],
        },
      ];

      mockPrismaService.customLeagueMatch.findMany.mockResolvedValue(
        mockMatches,
      );

      const result = await service.findAll();

      expect(result).toEqual(mockMatches);
      expect(
        mockPrismaService.customLeagueMatch.findMany,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('findOne', () => {
    it('should return a league match by id', async () => {
      const mockMatch = {
        id: 1,
        winnerId: null,
        ServerDiscordId: 'server123',
      };

      mockPrismaService.customLeagueMatch.findUnique.mockResolvedValue(
        mockMatch,
      );

      const result = await service.findOne(1);

      expect(result).toEqual(mockMatch);
      expect(
        mockPrismaService.customLeagueMatch.findUnique,
      ).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should throw NotFoundException if match not found', async () => {
      mockPrismaService.customLeagueMatch.findUnique.mockResolvedValue(null);

      await expect(service.findOne(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update a league match', async () => {
      const updateDto = { winnerId: 1 };
      const mockUpdatedMatch = {
        id: 1,
        winnerId: 1,
        ServerDiscordId: 'server123',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });

      mockPrismaService.customLeagueMatch.update.mockResolvedValue(
        mockUpdatedMatch,
      );

      const result = await service.update(1, updateDto);

      expect(result).toEqual(mockUpdatedMatch);
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.customLeagueMatch.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { winnerId: 1 },
      });
    });

    it('should throw NotFoundException if match not found', async () => {
      const updateDto = { winnerId: 1 };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '',
      });

      mockPrismaService.customLeagueMatch.update.mockRejectedValue(prismaError);

      await expect(service.update(1, updateDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should delete a league match', async () => {
      const mockMatch = {
        id: 1,
        Teams: [{ id: 1 }, { id: 2 }],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });

      mockPrismaService.customLeagueMatch.findUnique.mockResolvedValue(
        mockMatch,
      );
      mockPrismaService.teamLeague.delete.mockResolvedValue({});
      mockPrismaService.customLeagueMatch.delete.mockResolvedValue(mockMatch);

      const result = await service.remove(1);

      expect(result).toEqual(mockMatch);
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.teamLeague.delete).toHaveBeenCalledTimes(2);
      expect(mockPrismaService.customLeagueMatch.delete).toHaveBeenCalledTimes(
        1,
      );
    });

    it('should throw NotFoundException if match not found', async () => {
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });

      mockPrismaService.customLeagueMatch.findUnique.mockResolvedValue(null);

      await expect(service.remove(1)).rejects.toThrow(NotFoundException);
    });
  });
});
