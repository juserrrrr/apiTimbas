import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ScoutQueueService } from './scout-queue.service';
import { ClashService } from './clash.service';

const SCOUT_RESULT = { team: { id: 't1', name: 'Time' }, players: [], bans: [], counterplays: [], predictedPicks: [], strategy: '' };

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('ScoutQueueService', () => {
  let service: ScoutQueueService;
  let clash: { scout: jest.Mock; saveAnalysis: jest.Mock };

  beforeEach(async () => {
    clash = { scout: jest.fn(), saveAnalysis: jest.fn().mockResolvedValue({ id: 'analysis-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ScoutQueueService, { provide: ClashService, useValue: clash }],
    }).compile();

    service = module.get(ScoutQueueService);
  });

  it('enqueue returns a queued/running job immediately without waiting for the scout', () => {
    clash.scout.mockReturnValue(new Promise(() => {})); // nunca resolve

    const job = service.enqueue('Player', 'BR1');

    expect(['queued', 'running']).toContain(job.status);
    expect(job.id).toBeDefined();
    expect(job.result).toBeUndefined();
  });

  it('marks the job done with the result when the scout finishes', async () => {
    clash.scout.mockResolvedValue(SCOUT_RESULT);

    const { id } = service.enqueue('Player', 'BR1');
    await flush();

    const job = service.getJob(id);
    expect(job.status).toBe('done');
    expect(job.result).toEqual(SCOUT_RESULT);
    expect(job.progress.percent).toBe(100);
  });

  it('auto-saves the finished analysis to the history with search meta', async () => {
    clash.scout.mockResolvedValue(SCOUT_RESULT);

    const { id } = service.enqueue('Player', 'BR1', true);
    await flush();

    expect(clash.saveAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { searchedRiotId: 'Player#BR1', deep: true } }),
    );
    expect(service.getJob(id).analysisId).toBe('analysis-1');
  });

  it('still completes the job when the history auto-save fails', async () => {
    clash.scout.mockResolvedValue(SCOUT_RESULT);
    clash.saveAnalysis.mockRejectedValue(new Error('db offline'));

    const { id } = service.enqueue('Player', 'BR1');
    await flush();

    const job = service.getJob(id);
    expect(job.status).toBe('done');
    expect(job.analysisId).toBeUndefined();
  });

  it('marks the job as error with the message when the scout fails', async () => {
    clash.scout.mockRejectedValue(new Error('não está registrado em nenhum time'));

    const { id } = service.enqueue('Player', 'BR1');
    await flush();

    const job = service.getJob(id);
    expect(job.status).toBe('error');
    expect(job.error).toContain('não está registrado');
    expect(job.result).toBeUndefined();
  });

  it('processes jobs one at a time in FIFO order', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    clash.scout.mockImplementation((gameName: string) => {
      order.push(gameName);
      if (gameName === 'First') return new Promise((resolve) => { releaseFirst = () => resolve(SCOUT_RESULT); });
      return Promise.resolve(SCOUT_RESULT);
    });

    service.enqueue('First', 'BR1');
    const second = service.enqueue('Second', 'BR1');

    await flush();
    // segundo ainda não começou — está atrás do primeiro na fila
    expect(order).toEqual(['First']);
    expect(service.getJob(second.id).status).toBe('queued');
    expect(service.getJob(second.id).queuePosition).toBe(1);

    releaseFirst();
    await flush();
    expect(order).toEqual(['First', 'Second']);
    expect(service.getJob(second.id).status).toBe('done');
  });

  it('dedupes: enqueueing the same riotId while active returns the same job', () => {
    clash.scout.mockReturnValue(new Promise(() => {}));

    const first = service.enqueue('Player', 'BR1');
    const second = service.enqueue('player', 'br1'); // case-insensitive

    expect(second.id).toBe(first.id);
    expect(clash.scout).toHaveBeenCalledTimes(1);
  });

  it('does not dedupe a deep scout against a normal scout of the same player', () => {
    clash.scout.mockReturnValue(new Promise(() => {}));

    const normal = service.enqueue('Player', 'BR1');
    const deep = service.enqueue('Player', 'BR1', true);

    expect(deep.id).not.toBe(normal.id);
    expect(deep.deep).toBe(true);
    expect(normal.deep).toBe(false);
  });

  it('passes the deep flag through to ClashService.scout', async () => {
    clash.scout.mockResolvedValue(SCOUT_RESULT);

    service.enqueue('Player', 'BR1', true);
    await flush();

    expect(clash.scout).toHaveBeenCalledWith('Player', 'BR1', expect.any(Function), true);
  });

  it('reuses a recent finished result instead of scouting again', async () => {
    clash.scout.mockResolvedValue(SCOUT_RESULT);

    const first = service.enqueue('Player', 'BR1');
    await flush();

    const second = service.enqueue('Player', 'BR1');
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('done');
    expect(clash.scout).toHaveBeenCalledTimes(1);
  });

  it('exposes scout progress reported by ClashService', async () => {
    let report!: (p: any) => void;
    clash.scout.mockImplementation((_g: string, _t: string, onProgress: (p: any) => void) => {
      report = onProgress;
      return new Promise(() => {});
    });

    const { id } = service.enqueue('Player', 'BR1');
    await flush();

    report({ stage: 'players', message: 'Analisando jogador 2/5', percent: 40, current: 2, total: 5 });
    const job = service.getJob(id);
    expect(job.status).toBe('running');
    expect(job.progress.message).toBe('Analisando jogador 2/5');
    expect(job.progress.percent).toBe(40);
  });

  it('throws NotFoundException for unknown job ids', () => {
    expect(() => service.getJob('nope')).toThrow(NotFoundException);
  });
});
