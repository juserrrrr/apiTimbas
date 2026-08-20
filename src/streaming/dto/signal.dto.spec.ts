import { ValidationPipe } from '@nestjs/common';
import { PublicSignalDto } from './public-signal.dto';
import { SignalDto } from './signal.dto';

describe('SignalDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const offer = {
    from: 'host-peer',
    to: 'viewer-peer',
    type: 'offer',
    data: { type: 'offer', sdp: 'v=0' },
  };

  it('aceita o payload WebRTC no endpoint autenticado', async () => {
    const result = await pipe.transform(offer, {
      type: 'body',
      metatype: SignalDto,
    });

    expect(result).toEqual(offer);
  });

  it('aceita o payload WebRTC e o token no endpoint público', async () => {
    const body = { ...offer, guestToken: 'guest-token' };

    const result = await pipe.transform(body, {
      type: 'body',
      metatype: PublicSignalDto,
    });

    expect(result).toEqual(body);
  });

  it('continua recusando campos desconhecidos', async () => {
    await expect(
      pipe.transform(
        { ...offer, unexpected: true },
        {
          type: 'body',
          metatype: SignalDto,
        },
      ),
    ).rejects.toThrow();
  });
});
