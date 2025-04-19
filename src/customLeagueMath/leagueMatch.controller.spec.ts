import { Test, TestingModule } from '@nestjs/testing';
import { LeagueMatchController } from './leagueMatch.controller';
import { LeagueMatchService } from './leagueMatch.service';
import { CreateCustomLeagueMatchDto } from './dto/create-leagueMatch.dto';
import { UpdateCustomLeagueMatchDto } from './dto/update-leagueMatch.dto';

describe('LeagueMatchController', () => {
  let controller: LeagueMatchController;

  const mockLeagueMatchService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeagueMatchController],
      providers: [
        {
          provide: LeagueMatchService,
          useValue: mockLeagueMatchService,
        },
      ],
    }).compile();

    controller = module.get<LeagueMatchController>(LeagueMatchController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new league match', async () => {
      const createDto: CreateCustomLeagueMatchDto = {
        id: '',
        teamBlue: ['discord1', 'discord2'],
        teamRed: ['discord3', 'discord4'],
        ServerDiscordId: 'server123',
        winnerId: '',
        dateCreated: new Date(),
        dateUpdated: new Date(),
      };

      const expectedResult = {
        id: 1,
        winnerId: null,
        ServerDiscordId: 'server123',
        Teams: [],
      };

      mockLeagueMatchService.create.mockResolvedValue(expectedResult);

      const result = await controller.create(createDto);

      expect(result).toEqual(expectedResult);
      expect(mockLeagueMatchService.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('findAll', () => {
    it('should return all league matches', async () => {
      const expectedResult = [
        {
          id: 1,
          winnerId: null,
          ServerDiscordId: 'server123',
          Teams: [],
        },
      ];

      mockLeagueMatchService.findAll.mockResolvedValue(expectedResult);

      const result = await controller.findAll();

      expect(result).toEqual(expectedResult);
      expect(mockLeagueMatchService.findAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('findOne', () => {
    it('should return a league match by id', async () => {
      const expectedResult = {
        id: 1,
        winnerId: null,
        ServerDiscordId: 'server123',
      };

      mockLeagueMatchService.findOne.mockResolvedValue(expectedResult);

      const result = await controller.findOne(1);

      expect(result).toEqual(expectedResult);
      expect(mockLeagueMatchService.findOne).toHaveBeenCalledWith(1);
    });
  });

  describe('update', () => {
    it('should update a league match', async () => {
      const updateDto: UpdateCustomLeagueMatchDto = {
        winnerId: '1',
      };

      const expectedResult = {
        id: 1,
        winnerId: 1,
        ServerDiscordId: 'server123',
      };

      mockLeagueMatchService.update.mockResolvedValue(expectedResult);

      const result = await controller.update(1, updateDto);

      expect(result).toEqual(expectedResult);
      expect(mockLeagueMatchService.update).toHaveBeenCalledWith(1, updateDto);
    });
  });

  describe('remove', () => {
    it('should delete a league match', async () => {
      const expectedResult = {
        id: 1,
        winnerId: null,
        ServerDiscordId: 'server123',
      };

      mockLeagueMatchService.remove.mockResolvedValue(expectedResult);

      const result = await controller.remove(1);

      expect(result).toEqual(expectedResult);
      expect(mockLeagueMatchService.remove).toHaveBeenCalledWith(1);
    });
  });
});
