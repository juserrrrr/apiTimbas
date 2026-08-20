import { Test } from '@nestjs/testing';
import { Subject } from 'rxjs';
import * as request from 'supertest';
import { FeatureFlagGuard } from '../feature-flags/guards/feature-flag.guard';
import { StreamingEventsController } from './streaming-events.controller';
import { SignalEvent, StreamingService } from './streaming.service';

describe('StreamingEventsController', () => {
  const subject = new Subject<SignalEvent>();
  const streaming = {
    consumeTicket: jest.fn(),
    attach: jest.fn(() => subject),
    activate: jest.fn(() => subject.complete()),
    announce: jest.fn(),
    detach: jest.fn(),
  };

  afterEach(() => jest.clearAllMocks());

  it('abre o SSE com o ticket sem exigir Authorization', async () => {
    streaming.consumeTicket.mockReturnValue('host-peer');
    const module = await Test.createTestingModule({
      controllers: [StreamingEventsController],
      providers: [{ provide: StreamingService, useValue: streaming }],
    })
      .overrideGuard(FeatureFlagGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer()).get(
      '/streaming/streams/live-1/events?ticket=valid-ticket',
    );

    expect(response.status).toBe(200);
    expect(response.text).toContain('"type":"ready"');
    expect(streaming.consumeTicket).toHaveBeenCalledWith(
      'valid-ticket',
      'live-1',
    );
    expect(streaming.attach).toHaveBeenCalledWith('live-1', 'host-peer');
    await app.close();
  });

  it('recusa o SSE quando o ticket for inválido', async () => {
    streaming.consumeTicket.mockReturnValue(null);
    const module = await Test.createTestingModule({
      controllers: [StreamingEventsController],
      providers: [{ provide: StreamingService, useValue: streaming }],
    })
      .overrideGuard(FeatureFlagGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer()).get(
      '/streaming/streams/live-1/events?ticket=invalid',
    );

    expect(response.status).toBe(401);
    expect(streaming.attach).not.toHaveBeenCalled();
    await app.close();
  });
});
