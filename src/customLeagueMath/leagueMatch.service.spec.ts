import { Test, TestingModule } from '@nestjs/testing';
import { LeagueMatchService } from './leagueMatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../user/user.service';
import {
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Side } from './dto/create-leagueMatch.dto';

describe('LeagueMatchService', () => {
  let service: LeagueMatchService;

  const mockPrismaService = {
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
    },
  };

  const mockUserService = {
    findOneByDiscordId: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeagueMatchService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: UserService,
          useValue: mockUserService,
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
        id: '',
        teamBlue: ['discord1', 'discord2'],
        teamRed: ['discord3', 'discord4'],
        ServerDiscordId: 'server123',
        winnerId: '',
        dateCreated: new Date(),
        dateUpdated: new Date(),
      };

      const mockTeamBlueUsers = [
        { id: 1, discordId: 'discord1' },
        { id: 2, discordId: 'discord2' },
      ];

      const mockTeamRedUsers = [
        { id: 3, discordId: 'discord3' },
        { id: 4, discordId: 'discord4' },
      ];

      const mockTeamBlue = { id: 1, side: Side.BLUE };
      const mockTeamRed = { id: 2, side: Side.RED };
      const mockLeagueMatch = {
        id: 1,
        winnerId: null,
        ServerDiscordId: 'server123',
        Teams: [mockTeamBlue, mockTeamRed],
      };

      mockUserService.findOneByDiscordId
        .mockResolvedValueOnce(mockTeamBlueUsers[0])
        .mockResolvedValueOnce(mockTeamBlueUsers[1])
        .mockResolvedValueOnce(mockTeamRedUsers[0])
        .mockResolvedValueOnce(mockTeamRedUsers[1]);

      mockPrismaService.teamLeague.create
        .mockResolvedValueOnce(mockTeamBlue)
        .mockResolvedValueOnce(mockTeamRed);

      mockPrismaService.customLeagueMatch.create.mockResolvedValue(
        mockLeagueMatch,
      );

      const result = await service.create(createLeagueMatchDto);

      expect(result).toEqual(mockLeagueMatch);
      expect(mockUserService.findOneByDiscordId).toHaveBeenCalledTimes(4);
      expect(mockPrismaService.teamLeague.create).toHaveBeenCalledTimes(2);
      expect(mockPrismaService.customLeagueMatch.create).toHaveBeenCalledTimes(
        1,
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      const createLeagueMatchDto = {
        id: '',
        teamBlue: ['discord1'],
        teamRed: ['discord2'],
        ServerDiscordId: 'server123',
        winnerId: '',
        dateCreated: new Date(),
        dateUpdated: new Date(),
      };

      mockUserService.findOneByDiscordId.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      await expect(service.create(createLeagueMatchDto)).rejects.toThrow(
        NotFoundException,
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
      const updateDto = { winnerId: '1' };
      const mockWinner = { id: 1 };
      const mockUpdatedMatch = {
        id: 1,
        winnerId: 1,
        ServerDiscordId: 'server123',
      };

      mockPrismaService.teamLeague.findUnique.mockResolvedValue(mockWinner);
      mockPrismaService.customLeagueMatch.update.mockResolvedValue(
        mockUpdatedMatch,
      );

      const result = await service.update(1, updateDto);

      expect(result).toEqual(mockUpdatedMatch);
      expect(mockPrismaService.teamLeague.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
      });
      expect(mockPrismaService.customLeagueMatch.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { winnerId: 1 },
      });
    });

    it('should throw NotFoundException if winner team not found', async () => {
      const updateDto = { winnerId: '1' };

      mockPrismaService.teamLeague.findUnique.mockResolvedValue(null);

      await expect(service.update(1, updateDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle Prisma errors appropriately', async () => {
      const updateDto = { winnerId: '1' };
      const mockWinner = { id: 1 };

      mockPrismaService.teamLeague.findUnique.mockResolvedValue(mockWinner);
      mockPrismaService.customLeagueMatch.update.mockRejectedValue({
        code: 'P2025',
      });

      await expect(service.update(1, updateDto)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('remove', () => {
    it('should delete a league match', async () => {
      const mockDeletedMatch = {
        id: 1,
        winnerId: null,
        ServerDiscordId: 'server123',
      };

      mockPrismaService.customLeagueMatch.delete.mockResolvedValue(
        mockDeletedMatch,
      );

      const result = await service.remove(1);

      expect(result).toEqual(mockDeletedMatch);
      expect(mockPrismaService.customLeagueMatch.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should handle Prisma errors appropriately', async () => {
      mockPrismaService.customLeagueMatch.delete.mockRejectedValue({
        code: 'P2025',
      });

      await expect(service.remove(1)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
