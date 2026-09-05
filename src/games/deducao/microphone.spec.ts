import { Client, CloseCode } from 'colyseus';
import { setGameDeps, GameDeps } from '../game-deps';
import { GameMapService } from '../game-map.service';
import { DeducaoRoom } from './deducao.room';

jest.mock('colyseus', () =>
  process.getBuiltinModule('module').createRequire(__filename)('colyseus'),
);

type TestClient = Client & { send: jest.Mock };
type Handler = (client: Client, payload?: unknown) => void;
const rooms: DeducaoRoom[] = [];

async function harness(count = 4, adminHost = false) {
  setGameDeps({ maps: new GameMapService() } as GameDeps);
  const room = new DeducaoRoom();
  rooms.push(room);
  const handlers = new Map<string, Handler>();
  const register = room.onMessage.bind(room);
  jest.spyOn(room, 'onMessage').mockImplementation(((
    type: string,
    handler: Handler,
  ) => {
    handlers.set(String(type), handler);
    return register(type, handler);
  }) as typeof room.onMessage);
  jest.spyOn(room, 'setSimulationInterval').mockImplementation(() => {});
  jest.spyOn(room, 'setMetadata').mockResolvedValue(undefined);
  jest.spyOn(room, 'broadcast').mockImplementation(() => {});
  await room.onCreate({});
  const clients: TestClient[] = [];
  for (let index = 0; index < count; index++) {
    const client = {
      sessionId: `player-${index}`,
      send: jest.fn(),
    } as unknown as TestClient;
    clients.push(client);
    room.clients.push(client);
    await room.onJoin(
      client,
      {},
      {
        id: index + 1,
        discordId: `discord-${index}`,
        name: `Jogador ${index}`,
        avatar: null,
        role: index === 0 && adminHost ? 'ADMIN' : 'USER',
      },
    );
  }
  const send = (type: string, client: Client, payload?: unknown) =>
    handlers.get(type)!(client, payload);
  return {
    room,
    clients,
    host: clients[0],
    send,
    player: (client: Client) => room.state.players.get(client.sessionId)!,
    confirmAll() {
      for (const client of clients)
        send('microphone:status', client, { ready: true });
    },
    readyGuests() {
      for (const client of clients.slice(1)) send('ready', client);
    },
  };
}

afterEach(() => {
  for (const room of rooms) {
    room.clock.stop();
    room.clock.clear();
  }
  rooms.length = 0;
  jest.restoreAllMocks();
});

describe('microfone obrigatório na sala real', () => {
  it('começa sem confirmação e exige captura antes de marcar pronto', async () => {
    const h = await harness();
    const guest = h.clients[1];
    expect(h.player(guest).toJSON().microphoneReady).toBe(false);
    h.send('ready', guest);
    expect(h.player(guest).ready).toBe(false);
    expect(guest.send).toHaveBeenLastCalledWith(
      'erro',
      expect.stringContaining('microfone'),
    );
    h.send('microphone:status', guest, { ready: true });
    expect(h.player(guest).microphoneReady).toBe(true);
    expect(h.player(guest).ready).toBe(false);
    h.send('ready', guest);
    expect(h.player(guest).ready).toBe(true);
  });

  it('retirar a confirmação desmarca pronto e reativar captura não remarca sozinho', async () => {
    const h = await harness();
    const guest = h.clients[1];
    h.send('microphone:status', guest, { ready: true });
    h.send('ready', guest);
    h.send('microphone:status', guest, { ready: false });
    expect(h.player(guest).microphoneReady).toBe(false);
    expect(h.player(guest).ready).toBe(false);
    h.send('microphone:status', guest, { ready: true });
    expect(h.player(guest).ready).toBe(false);
    h.player(guest).ready = true;
    h.player(guest).microphoneReady = false;
    h.send('ready', guest);
    expect(h.player(guest).ready).toBe(false);
  });

  it.each([
    undefined,
    null,
    true,
    false,
    1,
    'true',
    [],
    {},
    { ready: 'true' },
    { ready: 1 },
    { ready: null },
    { ready: [] },
  ])(
    'ignora status inválido %j sem alterar a confirmação ou pronto',
    async (payload) => {
      const h = await harness();
      const guest = h.clients[1];
      h.send('microphone:status', guest, payload);
      expect(h.player(guest).microphoneReady).toBe(false);
      h.send('microphone:status', guest, { ready: true });
      h.send('ready', guest);
      h.send('microphone:status', guest, payload);
      expect(h.player(guest).microphoneReady).toBe(true);
      expect(h.player(guest).ready).toBe(true);
    },
  );

  it('altera só o remetente, sem aceitar jogador ausente, desconectado ou sem assento', async () => {
    const h = await harness();
    const guest = h.clients[1];
    h.send('microphone:status', guest, {
      ready: true,
      sessionId: h.host.sessionId,
    });
    expect(h.player(guest).microphoneReady).toBe(true);
    expect(h.player(h.host).microphoneReady).toBe(false);
    const absent = {
      sessionId: 'missing',
      send: jest.fn(),
    } as unknown as TestClient;
    h.send('microphone:status', absent, { ready: true });
    expect(h.room.state.players.has(absent.sessionId)).toBe(false);
    h.player(guest).connected = false;
    h.player(guest).microphoneReady = false;
    h.send('microphone:status', guest, { ready: true });
    h.send('ready', guest);
    expect(h.player(guest).microphoneReady).toBe(false);
    expect(h.player(guest).ready).toBe(false);
    h.player(guest).connected = true;
    (h.room as unknown as { seats: Map<string, unknown> }).seats.delete(
      guest.sessionId,
    );
    h.send('microphone:status', guest, { ready: true });
    h.send('ready', guest);
    expect(h.player(guest).microphoneReady).toBe(false);
    expect(h.player(guest).ready).toBe(false);
  });

  it('voice:join e sinalização não confirmam captura, nem voice:leave revoga um stream ativo', async () => {
    const h = await harness();
    const guest = h.clients[1];
    h.send('voice:join', guest);
    h.send('voice:signal', guest, { to: h.host.sessionId, kind: 'offer' });
    expect(h.player(guest).microphoneReady).toBe(false);
    h.send('microphone:status', guest, { ready: true });
    h.send('voice:leave', guest);
    expect(h.player(guest).microphoneReady).toBe(true);
  });

  it.each([0, 1])(
    'bloqueia início se falta microfone do jogador %s, incluindo anfitrião',
    async (index) => {
      const h = await harness();
      h.confirmAll();
      h.readyGuests();
      h.player(h.clients[index]).microphoneReady = false;
      h.send('start', h.host);
      expect(h.room.state.phase).toBe('lobby');
      expect(h.host.send).toHaveBeenLastCalledWith(
        'erro',
        expect.stringContaining('microfone'),
      );
      h.send('microphone:status', h.clients[index], { ready: true });
      h.send('start', h.host);
      expect(h.room.state.phase).toBe('jogando');
      expect(h.player(h.host).microphoneReady).toBe(true);
    },
  );

  it.each([0, 1])(
    'bloqueia início se o jogador %s está desconectado apesar de flags antigas',
    async (index) => {
      const h = await harness();
      h.confirmAll();
      h.readyGuests();
      h.player(h.clients[index]).connected = false;
      h.send('start', h.host);
      expect(h.room.state.phase).toBe('lobby');
      expect(h.host.send).toHaveBeenLastCalledWith(
        'erro',
        expect.stringContaining('conectados'),
      );
    },
  );

  it('continua exigindo pronto dos convidados, mas não um pronto extra do anfitrião', async () => {
    const h = await harness();
    h.confirmAll();
    h.send('start', h.host);
    expect(h.room.state.phase).toBe('lobby');
    expect(h.host.send).toHaveBeenLastCalledWith(
      'erro',
      'Ainda tem gente que não marcou pronto.',
    );
    h.readyGuests();
    expect(h.player(h.host).ready).toBe(false);
    h.send('start', h.clients[1]);
    expect(h.room.state.phase).toBe('lobby');
    h.send('start', h.host);
    expect(h.room.state.phase).toBe('jogando');
  });

  it('administrador solo também precisa confirmar o próprio microfone', async () => {
    const h = await harness(1, true);
    expect(h.room.state.hostCanStartSolo).toBe(true);
    h.send('start', h.host);
    expect(h.room.state.phase).toBe('lobby');
    h.send('microphone:status', h.host, { ready: true });
    h.send('start', h.host);
    expect(h.room.state.phase).toBe('jogando');
  });

  it('perder captura durante a partida atualiza status sem encerrar ou congelar o jogo', async () => {
    const h = await harness();
    h.confirmAll();
    h.readyGuests();
    h.send('start', h.host);
    const guest = h.clients[1];
    h.send('microphone:status', guest, { ready: false });
    expect(h.player(guest).microphoneReady).toBe(false);
    expect(h.room.state.phase).toBe('jogando');
    expect(h.player(guest).alive).toBe(true);
    h.send('ready', guest);
    expect(h.player(guest).ready).toBe(false);
    h.send('microphone:status', guest, { ready: true });
    expect(h.player(guest).microphoneReady).toBe(true);
  });

  it('sair do lobby limpa as flags antes de remover o jogador', async () => {
    const h = await harness();
    const guest = h.clients[1];
    h.send('microphone:status', guest, { ready: true });
    h.send('ready', guest);
    const before = h.player(guest);
    await h.room.onLeave(guest, CloseCode.CONSENTED);
    expect(before.connected).toBe(false);
    expect(before.ready).toBe(false);
    expect(before.microphoneReady).toBe(false);
    expect(h.room.state.players.has(guest.sessionId)).toBe(false);
  });

  it('reconexão mantém as flags desmarcadas até confirmação nova do mesmo jogador', async () => {
    const h = await harness();
    h.confirmAll();
    h.readyGuests();
    h.send('start', h.host);
    const guest = h.clients[1];
    const back = {
      sessionId: guest.sessionId,
      send: jest.fn(),
    } as unknown as TestClient;
    let resolve!: (client: Client) => void;
    const pending = new Promise<Client>((accept) => {
      resolve = accept;
    });
    jest
      .spyOn(h.room, 'allowReconnection')
      .mockImplementation(
        () =>
          pending as unknown as ReturnType<DeducaoRoom['allowReconnection']>,
      );
    h.player(guest).ready = true;
    const leaving = h.room.onLeave(guest, 1006);
    expect(h.player(guest).connected).toBe(false);
    expect(h.player(guest).ready).toBe(false);
    expect(h.player(guest).microphoneReady).toBe(false);
    h.send('microphone:status', guest, { ready: true });
    expect(h.player(guest).microphoneReady).toBe(false);
    resolve(back);
    await leaving;
    expect(h.player(back).connected).toBe(true);
    expect(h.player(back).microphoneReady).toBe(false);
    expect(h.player(back).ready).toBe(false);
    h.send('microphone:status', back, { ready: true });
    expect(h.player(back).microphoneReady).toBe(true);
  });

  it('reinício preserva captura mantida, mas exige novo pronto e reconfirmação de quem perdeu o microfone', async () => {
    const h = await harness();
    h.confirmAll();
    h.readyGuests();
    h.send('start', h.host);
    const guest = h.clients[1];
    h.send('microphone:status', guest, { ready: false });
    h.room.state.phase = 'fim';
    h.send('restart', h.host);
    expect(h.room.state.phase).toBe('lobby');
    expect(h.player(h.host).microphoneReady).toBe(true);
    expect(h.player(guest).microphoneReady).toBe(false);
    for (const player of h.room.state.players.values())
      expect(player.ready).toBe(false);
    h.readyGuests();
    h.send('start', h.host);
    expect(h.room.state.phase).toBe('lobby');
    h.send('microphone:status', guest, { ready: true });
    h.send('start', h.host);
    expect(h.room.state.phase).toBe('lobby');
    h.send('ready', guest);
    h.send('start', h.host);
    expect(h.room.state.phase).toBe('jogando');
  });
});
