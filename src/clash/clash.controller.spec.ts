import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ClashController } from './clash.controller';
import { ClashService } from './clash.service';
import { AuthGuard } from '../auth/guards/auth.guard';

const SCOUT_RESULT = {
  team: { id: 't1', name: 'Test Team', abbreviation: 'TT', iconId: 1, tier: 2 },
  players: [],
  bans: [],
  counterplays: [],
  predictedPicks: [],
  strategy: 'Aggressive early.',
};

describe('ClashController', () => {
  let controller: ClashController;
  let service: jest.Mocked<Pick<ClashService, 'scout'>>;

  beforeEach(async () => {
    service = { scout: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClashController],
      providers: [{ provide: ClashService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ClashController>(ClashController);
  });

  // ─── GET /clash/scout ──────────────────────────────────────────────────────

  describe('scout', () => {
    it('delegates to ClashService.scout with gameName and tagLine', async () => {
      service.scout.mockResolvedValue(SCOUT_RESULT as any);

      await controller.scout('PlayerName', 'BR1');

      expect(service.scout).toHaveBeenCalledWith('PlayerName', 'BR1');
    });

    it('returns the result from the service', async () => {
      service.scout.mockResolvedValue(SCOUT_RESULT as any);

      const result = await controller.scout('PlayerName', 'BR1');

      expect(result).toEqual(SCOUT_RESULT);
    });

    it('throws BadRequestException when gameName is empty', async () => {
      await expect(controller.scout('', 'BR1')).rejects.toThrow(BadRequestException);
      expect(service.scout).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when tagLine is empty', async () => {
      await expect(controller.scout('PlayerName', '')).rejects.toThrow(BadRequestException);
      expect(service.scout).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when both params are missing', async () => {
      await expect(controller.scout(undefined as any, undefined as any)).rejects.toThrow(BadRequestException);
      expect(service.scout).not.toHaveBeenCalled();
    });

    it('accepts gameName with spaces', async () => {
      service.scout.mockResolvedValue(SCOUT_RESULT as any);

      await controller.scout('Player With Spaces', 'BR1');

      expect(service.scout).toHaveBeenCalledWith('Player With Spaces', 'BR1');
    });

    it('does not use discordId or any user identity — endpoint is identity-free', async () => {
      service.scout.mockResolvedValue(SCOUT_RESULT as any);

      await controller.scout('AnyPlayer', 'BR1');

      // scout() takes only gameName+tagLine, no discordId
      expect(service.scout).toHaveBeenCalledWith('AnyPlayer', 'BR1');
      expect(service.scout).toHaveBeenCalledTimes(1);
    });
  });
});
