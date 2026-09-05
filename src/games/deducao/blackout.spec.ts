import { Client } from 'colyseus';
import { setGameDeps, GameDeps } from '../game-deps';
import { GameMapService } from '../game-map.service';
import { DeducaoRoom } from './deducao.room';
import { PlayerState } from './deducao.state';
import { Role } from './rules';

// O carregador nativo do Node suporta dependências ESM do Colyseus que o Jest 29 não carrega.
jest.mock('colyseus', () =>
  process.getBuiltinModule('module').createRequire(__filename)('colyseus'),
);

type TestClient = Client & { send: jest.Mock };
type Handler = (client: Client, payload?: unknown) => void;
interface RoomInternals {
  seats: Map<
    string,
    { role: Role; sabotageReadyAt: number; lastMoveAt: number }
  >;
  beginMatch(ids: string[]): void;
  openMeeting(reason: 'emergencia', by: PlayerState, victimName: string): void;
  checkEnd(): boolean;
}

const COOLDOWN = 40_000;
let now = 1_000_000;
let fixtures: DeducaoRoom[] = [];

async function harness(count = 7) {
  setGameDeps({ maps: new GameMapService() } as GameDeps);
  const room = new DeducaoRoom();
  fixtures.push(room);
  const internal = room as unknown as RoomInternals;
  const handlers = new Map<string, Handler>();
  const register = room.onMessage.bind(room);
  jest.spyOn(room, 'onMessage').mockImplementation(((
    type: string,
    handler: Handler,
  ) => {
    handlers.set(String(type), handler);
    return register(type, handler);
  }) as typeof room.onMessage);
  let tick = () => {};
  jest.spyOn(room, 'setSimulationInterval').mockImplementation((callback) => {
    tick = () => callback(50);
  });
  jest.spyOn(room, 'setMetadata').mockResolvedValue(undefined);
  const broadcast = jest.spyOn(room, 'broadcast').mockImplementation(() => {});
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
        role: 'USER',
      },
    );
  }
  handlers.get('config')!(clients[0], { killers: 2, blackoutEverySeconds: 1 });
  for (const client of clients.slice(1)) handlers.get('ready')!(client);
  handlers.get('start')!(clients[0]);
  expect(room.state.phase).toBe('jogando');
  const killers = clients.filter(
    (client) => internal.seats.get(client.sessionId)!.role === 'assassino',
  );
  return {
    room,
    internal,
    clients,
    killers,
    broadcast,
    tick,
    player: (client: Client) => room.state.players.get(client.sessionId)!,
    seat: (client: Client) => internal.seats.get(client.sessionId)!,
    send: (type: string, client: Client, payload?: unknown) =>
      handlers.get(type)!(client, payload),
    advance(ms: number) {
      now += ms;
      tick();
    },
  };
}

beforeEach(() => {
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  for (const room of fixtures) {
    room.clock.stop();
    room.clock.clear();
  }
  fixtures = [];
  jest.restoreAllMocks();
});

describe('apagão na sala real', () => {
  it('não inicia sozinho nem depois de um dia inteiro, apesar de configuração antiga', async () => {
    const h = await harness();
    expect(h.room.state.config).not.toHaveProperty('blackoutEverySeconds');
    for (let minute = 0; minute < 24 * 60; minute++) {
      h.advance(60_000);
      expect(h.room.state.blackout).toBe(false);
      expect(h.room.state.blackoutEndsAt).toBe(0);
    }
    expect(h.broadcast).not.toHaveBeenCalledWith('apagao', expect.anything());
  });

  it('envia prazo inicial privado e aceita só no instante autorizado pelo servidor', async () => {
    const h = await harness();
    const killer = h.killers[0];
    const initial = now + COOLDOWN;
    for (const client of h.clients) {
      const statuses = client.send.mock.calls.filter(
        ([type]) => type === 'sabotage:status',
      );
      if (h.seat(client).role === 'assassino') {
        expect(statuses).toEqual([
          [
            'sabotage:status',
            { readyAt: initial, serverNow: now, cooldownMs: COOLDOWN },
          ],
        ]);
        expect(client.send.mock.calls[0][0]).toBe('papel');
      } else expect(statuses).toHaveLength(0);
    }
    h.advance(COOLDOWN - 1);
    h.send('sabotage', killer, { readyAt: 0, cooldownMs: 0 });
    expect(h.room.state.blackout).toBe(false);
    expect(h.seat(killer).sabotageReadyAt).toBe(initial);
    h.advance(1);
    h.send('sabotage', killer);
    expect(h.room.state.blackout).toBe(true);
    expect(h.room.state.blackoutEndsAt).toBe(now + 25_000);
    expect(h.seat(killer).sabotageReadyAt).toBe(now + COOLDOWN);
    expect(killer.send).toHaveBeenLastCalledWith('sabotage:status', {
      readyAt: now + COOLDOWN,
      serverNow: now,
      cooldownMs: COOLDOWN,
    });
    expect(h.broadcast).toHaveBeenCalledTimes(1);
    expect(h.broadcast).toHaveBeenCalledWith('apagao', { until: now + 25_000 });
    for (const player of h.room.state.players.values()) {
      expect(player.toJSON()).not.toHaveProperty('sabotageReadyAt');
      expect(player.toJSON()).not.toHaveProperty('role');
    }
  });

  it.each(['funcionario', 'detetive'] as const)(
    'não permite apagar nem consultar prazo alheio com papel %s',
    async (role) => {
      const h = await harness();
      const client = h.clients.find(
        (candidate) => h.seat(candidate).role === role,
      )!;
      h.advance(COOLDOWN);
      client.send.mockClear();
      h.send('sabotage', client);
      h.send('sabotage:status', client, { sessionId: h.killers[0].sessionId });
      expect(h.room.state.blackout).toBe(false);
      expect(client.send).not.toHaveBeenCalled();
    },
  );

  it.each([
    'morto',
    'desconectado',
    'ausente',
    'sem-assento',
    'lobby',
    'reuniao',
    'votacao',
    'fim',
  ])('recusa ativação por %s', async (reason) => {
    const h = await harness();
    const killer = h.killers[0];
    const seat = h.seat(killer);
    h.advance(COOLDOWN);
    const previous = seat.sabotageReadyAt;
    if (reason === 'morto') h.player(killer).alive = false;
    else if (reason === 'desconectado') h.player(killer).connected = false;
    else if (reason === 'ausente')
      h.room.state.players.delete(killer.sessionId);
    else if (reason === 'sem-assento')
      h.internal.seats.delete(killer.sessionId);
    else h.room.state.phase = reason;
    h.send('sabotage', killer);
    expect(h.room.state.blackout).toBe(false);
    expect(seat.sabotageReadyAt).toBe(previous);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it('não reinicia a duração nem gasta outro cooldown com apagão já ativo', async () => {
    const h = await harness();
    const [first, second] = h.killers;
    h.room.state.config.blackoutSeconds = 60;
    h.advance(COOLDOWN);
    h.send('sabotage', first);
    const endsAt = h.room.state.blackoutEndsAt;
    const firstReadyAt = h.seat(first).sabotageReadyAt;
    const secondReadyAt = h.seat(second).sabotageReadyAt;
    h.send('sabotage', first);
    h.send('sabotage', second);
    h.advance(COOLDOWN);
    h.send('sabotage', first);
    h.send('sabotage', second);
    expect(h.room.state.blackoutEndsAt).toBe(endsAt);
    expect(h.seat(first).sabotageReadyAt).toBe(firstReadyAt);
    expect(h.seat(second).sabotageReadyAt).toBe(secondReadyAt);
    expect(h.broadcast).toHaveBeenCalledTimes(1);
    h.advance(20_000);
    expect(h.room.state.blackout).toBe(false);
    expect(h.room.state.blackoutEndsAt).toBe(0);
    h.send('sabotage', second);
    expect(h.room.state.blackout).toBe(true);
    expect(h.seat(second).sabotageReadyAt).toBe(now + COOLDOWN);
    expect(h.broadcast).toHaveBeenCalledTimes(2);
  });

  it('restaura na duração configurada sem ignorar o restante do cooldown pessoal', async () => {
    const h = await harness();
    const killer = h.killers[0];
    h.advance(COOLDOWN);
    h.send('sabotage', killer);
    const readyAt = h.seat(killer).sabotageReadyAt;
    h.advance(24_999);
    expect(h.room.state.blackout).toBe(true);
    h.advance(1);
    expect(h.room.state.blackout).toBe(false);
    h.send('sabotage', killer);
    expect(h.room.state.blackout).toBe(false);
    expect(h.seat(killer).sabotageReadyAt).toBe(readyAt);
    h.advance(14_999);
    h.send('sabotage', killer);
    expect(h.room.state.blackout).toBe(false);
    h.advance(1);
    h.send('sabotage', killer);
    expect(h.room.state.blackout).toBe(true);
  });

  it('reconecta com o mesmo prazo e responde à sincronização sem confiar no payload', async () => {
    const h = await harness();
    const killer = h.killers[0];
    h.advance(COOLDOWN);
    h.send('sabotage', killer);
    const readyAt = h.seat(killer).sabotageReadyAt;
    const back = {
      sessionId: killer.sessionId,
      send: jest.fn(),
    } as unknown as TestClient;
    const reconnect = jest
      .spyOn(h.room, 'allowReconnection')
      .mockResolvedValue(back);
    h.advance(5_000);
    await h.room.onLeave(killer, 1006);
    expect(reconnect).toHaveBeenCalledWith(killer, 40);
    expect(h.player(back).connected).toBe(true);
    expect(h.seat(back).sabotageReadyAt).toBe(readyAt);
    expect(back.send).toHaveBeenLastCalledWith('sabotage:status', {
      readyAt,
      serverNow: now,
      cooldownMs: COOLDOWN,
    });
    h.send('sabotage:status', back, {
      readyAt: 0,
      serverNow: 0,
      sessionId: h.killers[1].sessionId,
    });
    expect(back.send).toHaveBeenCalledTimes(2);
    expect(back.send).toHaveBeenLastCalledWith('sabotage:status', {
      readyAt,
      serverNow: now,
      cooldownMs: COOLDOWN,
    });
    expect(h.seat(back).sabotageReadyAt).toBe(readyAt);
  });

  it('reunião restaura todo o mapa e nunca agenda outro apagão ao voltar', async () => {
    const h = await harness();
    h.advance(COOLDOWN);
    h.send('sabotage', h.killers[0]);
    h.internal.openMeeting('emergencia', h.player(h.clients[0]), '');
    expect(h.room.state.blackout).toBe(false);
    expect(h.room.state.blackoutEndsAt).toBe(0);
    h.advance(45_000);
    expect(h.room.state.phase).toBe('votacao');
    h.advance(30_000);
    h.advance(6_000);
    expect(h.room.state.phase).toBe('jogando');
    h.advance(24 * 60 * 60_000);
    expect(h.room.state.blackout).toBe(false);
    expect(h.broadcast).toHaveBeenCalledTimes(1);
  });

  it('fim e próxima partida restauram a luz e reiniciam apenas o cooldown pessoal', async () => {
    const h = await harness();
    h.advance(COOLDOWN);
    h.send('sabotage', h.killers[0]);
    h.room.state.tasksDone = h.room.state.tasksTotal;
    expect(h.internal.checkEnd()).toBe(true);
    expect(h.room.state.phase).toBe('fim');
    expect(h.room.state.blackout).toBe(false);
    expect(h.room.state.blackoutEndsAt).toBe(0);
    h.send('restart', h.clients[0]);
    h.internal.beginMatch(h.clients.map((client) => client.sessionId));
    for (const client of h.clients)
      expect(h.seat(client).sabotageReadyAt).toBe(now + COOLDOWN);
    h.advance(24 * 60 * 60_000);
    expect(h.room.state.blackout).toBe(false);
  });
});

describe('confirmação de movimento na sala real', () => {
  it('confirma pacotes aceitos em ordem, sem aplicar pacotes antigos ou duplicados', async () => {
    const h = await harness();
    const client = h.clients[0];
    const player = h.player(client);
    const move = (sequence: number, moving = true) =>
      h.send('move', client, {
        x: player.x + 0.1,
        z: player.z,
        dir: 1,
        moving,
        sequence,
      });
    h.advance(50);
    move(1);
    expect(player.moveSequence).toBe(1);
    expect(player.moving).toBe(true);
    h.advance(50);
    move(3, false);
    expect(player.moveSequence).toBe(3);
    expect(player.moving).toBe(false);
    const accepted = player.toJSON();
    const lastMoveAt = h.seat(client).lastMoveAt;
    h.advance(500);
    move(2);
    move(3);
    expect(player.toJSON()).toEqual(accepted);
    expect(h.seat(client).lastMoveAt).toBe(lastMoveAt);
    move(4);
    expect(player.moveSequence).toBe(4);
    expect(h.seat(client).lastMoveAt).toBe(now);
  });

  it.each([
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '1',
    null,
    true,
  ])(
    'ignora sequência inválida %s sem gastar orçamento de movimento',
    async (sequence) => {
      const h = await harness();
      const client = h.clients[0];
      const player = h.player(client);
      const previous = player.toJSON();
      const lastMoveAt = h.seat(client).lastMoveAt;
      h.advance(50);
      h.send('move', client, {
        x: player.x + 1,
        z: player.z,
        dir: 1,
        moving: true,
        sequence,
      });
      expect(player.toJSON()).toEqual(previous);
      expect(h.seat(client).lastMoveAt).toBe(lastMoveAt);
    },
  );

  it('não confirma posição inválida ou movimento durante reunião', async () => {
    const h = await harness();
    const client = h.clients[0];
    const player = h.player(client);
    for (const x of [NaN, Infinity, '12']) {
      h.send('move', client, {
        x,
        z: player.z,
        dir: 0,
        moving: true,
        sequence: 1,
      });
      expect(player.moveSequence).toBe(0);
    }
    h.internal.openMeeting('emergencia', player, '');
    h.send('move', client, {
      x: player.x + 1,
      z: player.z,
      dir: 1,
      moving: true,
      sequence: 1,
    });
    expect(player.moveSequence).toBe(0);
  });

  it('continua aceitando clientes antigos sem sequência sem zerar confirmação existente', async () => {
    const h = await harness();
    const client = h.clients[0];
    const player = h.player(client);
    h.advance(50);
    h.send('move', client, {
      x: player.x,
      z: player.z,
      dir: 1,
      moving: true,
      sequence: 5,
    });
    h.advance(50);
    h.send('move', client, { x: player.x, z: player.z, dir: 2, moving: false });
    expect(player.moveSequence).toBe(5);
    expect(player.dir).toBe(2);
    expect(player.moving).toBe(false);
    expect(h.seat(client).lastMoveAt).toBe(now);
  });
});
