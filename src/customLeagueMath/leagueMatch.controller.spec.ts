import { Test, TestingModule } from '@nestjs/testing';
import { LeagueMatchController } from './leagueMatch.controller';
import { LeagueMatchService } from './leagueMatch.service';
import { CreateCustomLeagueMatchDto } from './dto/create-leagueMatch.dto';
import { UpdateCustomLeagueMatchDto } from './dto/update-leagueMatch.dto';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { GameMode, Role } from '@prisma/client';

describe('LeagueMatchController', () => {
  let controller: LeagueMatchController;

  const mockLeagueMatchService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    createOnline: jest.fn(),
    announceMatchToGuild: jest.fn().mockResolvedValue(undefined),
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
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RoleGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<LeagueMatchController>(LeagueMatchController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new league match', async () => {
      const createDto: CreateCustomLeagueMatchDto = {
        riotMatchId: 'BR1_12345',
        teamBlue: {
          players: [{ userId: 1 }, { userId: 2 }],
        },
        teamRed: {
          players: [{ userId: 3 }, { userId: 4 }],
        },
        ServerDiscordId: 'server123',
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

  describe('createOnline', () => {
    const req = { tokenPayload: { discordId: 'user-1', role: Role.PLAYER } };

    it('deve anunciar o embed no Discord com o gameMode salvo na partida', async () => {
      // Regressão: o anúncio precisa usar o modo persistido, senão uma partida
      // de ARAM criada pelo site aparece como Summoner's Rift atual no Discord.
      mockLeagueMatchService.createOnline.mockResolvedValue({
        id: 7,
        playersPerTeam: 5,
        gameMode: GameMode.ARAM,
      });

      await controller.createOnline(
        { discordServerId: 'server-1', gameMode: GameMode.ARAM } as any,
        req,
      );

      expect(mockLeagueMatchService.announceMatchToGuild).toHaveBeenCalledWith(
        7,
        'server-1',
        undefined,
        5,
        GameMode.ARAM,
      );
    });

    it("deve anunciar como Summoner's Rift atual quando a partida foi criada sem modo", async () => {
      mockLeagueMatchService.createOnline.mockResolvedValue({
        id: 8,
        playersPerTeam: 5,
        gameMode: GameMode.SUMMONERS_RIFT,
      });

      await controller.createOnline({ discordServerId: 'server-1' } as any, req);

      expect(mockLeagueMatchService.announceMatchToGuild).toHaveBeenCalledWith(
        8,
        'server-1',
        undefined,
        5,
        GameMode.SUMMONERS_RIFT,
      );
    });

    it('não deve derrubar a criação se o anúncio no Discord falhar', async () => {
      mockLeagueMatchService.createOnline.mockResolvedValue({
        id: 9,
        playersPerTeam: 5,
        gameMode: GameMode.ARAM,
      });
      mockLeagueMatchService.announceMatchToGuild.mockRejectedValueOnce(new Error('Discord fora do ar'));

      const result = await controller.createOnline({ discordServerId: 'server-1' } as any, req);

      expect(result).toEqual(expect.objectContaining({ id: 9 }));
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
        winnerId: 1,
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
