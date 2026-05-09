import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PlayerStatsController } from './player-stats.controller';
import { PlayerStatsService } from './player-stats.service';

describe('PlayerStatsController', () => {
  let controller: PlayerStatsController;
  let service: jest.Mocked<Pick<PlayerStatsService, 'getRiotPlayer'>>;

  beforeEach(async () => {
    service = { getRiotPlayer: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlayerStatsController],
      providers: [{ provide: PlayerStatsService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PlayerStatsController>(PlayerStatsController);
  });

  it('delegates to PlayerStatsService.getRiotPlayer', async () => {
    service.getRiotPlayer.mockResolvedValue({ player: { riotId: 'Player#BR1' } } as any);

    await controller.riot('Player', 'BR1');

    expect(service.getRiotPlayer).toHaveBeenCalledWith('Player', 'BR1');
  });

  it('throws BadRequestException when params are missing', async () => {
    await expect(controller.riot('', 'BR1')).rejects.toThrow(BadRequestException);
    await expect(controller.riot('Player', '')).rejects.toThrow(BadRequestException);
    expect(service.getRiotPlayer).not.toHaveBeenCalled();
  });
});
