import { TurnService } from './turn.service';

describe('TurnService', () => {
  afterEach(() => {
    delete process.env.TURN_URLS;
    delete process.env.TURN_USERNAME;
    delete process.env.TURN_CREDENTIAL;
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    delete process.env.CLOUDFLARE_TURN_API_TOKEN;
  });

  it('devolve só STUN quando não há relay configurado', async () => {
    const service = new TurnService();

    const servers = await service.iceServers();

    expect(service.hasRelay()).toBe(false);
    expect(servers).toHaveLength(1);
    expect(servers[0].urls).toEqual(
      expect.arrayContaining(['stun:stun.l.google.com:19302']),
    );
  });

  it('usa o Coturn do VPS quando ele está configurado', async () => {
    process.env.TURN_URLS = 'turn:relay.timbas.gg:3478,turn:relay.timbas.gg:3478?transport=tcp';
    process.env.TURN_USERNAME = 'timbas';
    process.env.TURN_CREDENTIAL = 'segredo';
    const service = new TurnService();

    const servers = await service.iceServers();

    expect(service.hasRelay()).toBe(true);
    expect(servers[1]).toEqual({
      urls: ['turn:relay.timbas.gg:3478', 'turn:relay.timbas.gg:3478?transport=tcp'],
      username: 'timbas',
      credential: 'segredo',
    });
  });

  it('prefere o Coturn próprio ao TURN gerenciado', async () => {
    process.env.TURN_URLS = 'turn:relay.timbas.gg:3478';
    process.env.CLOUDFLARE_TURN_KEY_ID = 'turn-key-id';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'turn-api-token';
    const request = jest.spyOn(global, 'fetch');
    const service = new TurnService();

    try {
      await service.iceServers();
      expect(request).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
    }
  });

  it('gera credenciais temporárias pela Cloudflare', async () => {
    process.env.CLOUDFLARE_TURN_KEY_ID = 'turn-key-id';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'turn-api-token';
    const request = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        iceServers: [
          {
            urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
            username: 'temporary-user',
            credential: 'temporary-credential',
          },
        ],
      }),
    } as Response);

    try {
      const servers = await new TurnService().iceServers();

      expect(servers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
          }),
        ]),
      );
      expect(request).toHaveBeenCalledWith(
        expect.stringContaining(
          '/turn/keys/turn-key-id/credentials/generate-ice-servers',
        ),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer turn-api-token',
          }),
        }),
      );
    } finally {
      request.mockRestore();
    }
  });

  it('mantém a live de pé quando a Cloudflare falha', async () => {
    process.env.CLOUDFLARE_TURN_KEY_ID = 'turn-key-id';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'turn-api-token';
    const request = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 500 } as Response);

    try {
      // Sem relay é pior, mas ainda conecta quem não precisa dele.
      await expect(new TurnService().iceServers()).resolves.toHaveLength(1);
    } finally {
      request.mockRestore();
    }
  });
});
