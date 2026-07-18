import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ClashController } from './clash.controller';
import { ClashService } from './clash.service';
import { ScoutQueueService } from './scout-queue.service';
import { AuthGuard } from '../auth/guards/auth.guard';

const SCOUT_RESULT = {
  team: { id: 't1', name: 'Test Team', abbreviation: 'TT', iconId: 1, tier: 2 },
  players: [],
  bans: [],
  counterplays: [],
  predictedPicks: [],
  strategy: 'Aggressive early.',
};

const QUEUED_JOB = {
  id: 'job-1',
  riotId: 'PlayerName#BR1',
  status: 'queued' as const,
  queuePosition: 1,
  progress: { stage: 'queued', message: 'Na fila', percent: 0 },
  createdAt: Date.now(),
};

describe('ClashController', () => {
  let controller: ClashController;
  let service: jest.Mocked<Pick<ClashService, 'scout'>>;
  let queue: jest.Mocked<Pick<ScoutQueueService, 'enqueue' | 'getJob'>>;

  beforeEach(async () => {
    service = { scout: jest.fn() };
    queue = { enqueue: jest.fn(), getJob: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClashController],
      providers: [
        { provide: ClashService, useValue: service },
        { provide: ScoutQueueService, useValue: queue },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ClashController>(ClashController);
  });

  // ─── POST /clash/scout (fila assíncrona) ───────────────────────────────────

  describe('startScout', () => {
    it('enqueues the scout and returns the job immediately', () => {
      queue.enqueue.mockReturnValue(QUEUED_JOB as any);

      const result = controller.startScout({ gameName: 'PlayerName', tagLine: 'BR1' });

      expect(queue.enqueue).toHaveBeenCalledWith('PlayerName', 'BR1', false);
      expect(result).toEqual(QUEUED_JOB);
    });

    it('trims gameName and tagLine before enqueueing', () => {
      queue.enqueue.mockReturnValue(QUEUED_JOB as any);

      controller.startScout({ gameName: '  PlayerName ', tagLine: ' BR1 ' });

      expect(queue.enqueue).toHaveBeenCalledWith('PlayerName', 'BR1', false);
    });

    it('passes deep=true through to the queue', () => {
      queue.enqueue.mockReturnValue(QUEUED_JOB as any);

      controller.startScout({ gameName: 'PlayerName', tagLine: 'BR1', deep: true });

      expect(queue.enqueue).toHaveBeenCalledWith('PlayerName', 'BR1', true);
    });

    it('throws BadRequestException when gameName is missing', () => {
      expect(() => controller.startScout({ tagLine: 'BR1' })).toThrow(BadRequestException);
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when tagLine is missing', () => {
      expect(() => controller.startScout({ gameName: 'PlayerName' })).toThrow(BadRequestException);
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when body is empty', () => {
      expect(() => controller.startScout({} as any)).toThrow(BadRequestException);
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });

  // ─── GET /clash/scout/jobs/:id ─────────────────────────────────────────────

  describe('getScoutJob', () => {
    it('returns the job from the queue service', () => {
      queue.getJob.mockReturnValue({ ...QUEUED_JOB, status: 'done', result: SCOUT_RESULT } as any);

      const result = controller.getScoutJob('job-1');

      expect(queue.getJob).toHaveBeenCalledWith('job-1');
      expect((result as any).result).toEqual(SCOUT_RESULT);
    });
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
