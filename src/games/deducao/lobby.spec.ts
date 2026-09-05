import { Client, CloseCode } from 'colyseus';
import { setGameDeps, GameDeps } from '../game-deps';
import { GameMapService } from '../game-map.service';
import { DeducaoRoom } from './deducao.room';
import { LOBBY_MAP } from './lobby-map';
import { collidersFor, OFFICE_MAP } from './map';
import { distance, PLAYER_RADIUS, resolveCollisions } from './movement';

jest.mock('colyseus', () =>
  process.getBuiltinModule('module').createRequire(__filename)('colyseus'),
);

type TestClient = Client & { send: jest.Mock };
type Handler = (client: Client, payload?: unknown) => void;
const rooms: DeducaoRoom[] = [];

async function harness(count = 4) {
  let now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
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
  async function join(index: number) {
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
    return client;
  }
  for (let index = 0; index < count; index++) await join(index);
  const send = (type: string, client: Client, payload?: unknown) =>
    handlers.get(type)!(client, payload);
  const player = (client = clients[0]) =>
    room.state.players.get(client.sessionId)!;
  return {
    room,
    clients,
    send,
    player,
    join,
    advance(ms = 50) {
      now += ms;
    },
    move(x: number, z: number, extra: object = {}, client = clients[0]) {
      now += 50;
      send('move', client, {
        x,
        z,
        dir: 0,
        moving: true,
        sequence: player(client).moveSequence + 1,
        ...extra,
      });
    },
    start() {
      for (const client of clients) {
        send('microphone:status', client, { ready: true });
        if (client !== clients[0]) send('ready', client);
      }
      send('start', clients[0]);
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

describe('sala de espera compartilhada', () => {
  it('tem uma sala, doze entradas livres e nenhuma tarefa ou passagem para o escritório', () => {
    expect(LOBBY_MAP.bounds).toEqual({ x: -6, z: -5, w: 12, d: 10 });
    expect(LOBBY_MAP.rooms).toHaveLength(1);
    expect(LOBBY_MAP.spawns).toHaveLength(12);
    expect(LOBBY_MAP.taskSpots).toEqual([]);
    expect(LOBBY_MAP.vents).toEqual([]);
    expect(LOBBY_MAP.stairs).toEqual([]);
    for (const [index, spawn] of LOBBY_MAP.spawns.entries()) {
      expect(spawn.level).toBe(0);
      expect(resolveCollisions(spawn, collidersFor(0, LOBBY_MAP))).toEqual({
        x: spawn.x,
        z: spawn.z,
      });
      for (const other of LOBBY_MAP.spawns.slice(index + 1))
        expect(distance(spawn, other)).toBeGreaterThan(PLAYER_RADIUS * 2);
    }
  });

  it('coloca doze jogadores no lobby antes de confirmar microfone ou prontidão', async () => {
    const h = await harness(12);
    for (const [index, client] of h.clients.entries()) {
      expect(h.player(client)).toMatchObject({
        ...LOBBY_MAP.spawns[index],
        ready: false,
        microphoneReady: false,
      });
    }
    expect(h.room.state.mapId).toBe('original');
    expect(h.room.state.mapName).toBe(OFFICE_MAP.name);
  });

  it('reutiliza a entrada livre quando alguém sai, sem sobrepor quem ficou', async () => {
    const h = await harness(12);
    const left = h.clients[2];
    await h.room.onLeave(left, CloseCode.CONSENTED);
    h.room.clients.splice(h.room.clients.indexOf(left), 1);
    const joined = await h.join(12);
    expect(h.player(joined)).toMatchObject(LOBBY_MAP.spawns[2]);
    for (const other of h.room.state.players.values()) {
      if (other.id !== joined.sessionId)
        expect(distance(other, h.player(joined))).toBeGreaterThanOrEqual(
          PLAYER_RADIUS * 2,
        );
    }
  });

  it('aceita caminhada, corrida, agachar e pular sem marcar pronto ou confirmar microfone', async () => {
    const h = await harness();
    const before = { x: h.player().x, z: h.player().z };
    h.move(before.x + 0.2, before.z, { dir: 1.2, crouching: true });
    expect(h.player()).toMatchObject({
      x: before.x + 0.2,
      dir: 1.2,
      crouching: true,
      moving: true,
      moveSequence: 1,
    });
    h.move(h.player().x + 0.4, h.player().z, {
      sprint: true,
      crouching: false,
      airborne: true,
      elevation: 0.7,
    });
    expect(h.player()).toMatchObject({
      airborne: true,
      elevation: 0.7,
      crouching: false,
      moveSequence: 2,
      level: 0,
      ready: false,
      microphoneReady: false,
    });
    h.move(h.player().x, h.player().z, {
      moving: false,
      airborne: false,
      elevation: 0,
    });
    expect(h.player()).toMatchObject({
      moving: false,
      airborne: false,
      elevation: 0,
    });
  });

  it.each([
    { from: { x: 0, z: 0 }, to: { x: 0, z: -20 }, axis: 'z', stop: -4.55 },
    { from: { x: 0, z: 0 }, to: { x: 0, z: 20 }, axis: 'z', stop: 4.55 },
    {
      from: { x: 0, z: -2.5 },
      to: { x: -20, z: -2.5 },
      axis: 'x',
      stop: -5.55,
    },
    { from: { x: 0, z: -2.5 }, to: { x: 20, z: -2.5 }, axis: 'x', stop: 5.55 },
  ] as const)(
    'barra a parede no eixo $axis em $stop, mesmo pulando',
    async ({ from, to, axis, stop }) => {
      const h = await harness();
      Object.assign(h.player(), from);
      for (let index = 0; index < 60; index++)
        h.move(to.x, to.z, { sprint: true, airborne: true, elevation: 1.2 });
      expect(h.player()[axis]).toBeCloseTo(stop, 5);
      expect(h.player().level).toBe(0);
    },
  );

  it.each([
    { from: { x: 0, z: 0 }, to: { x: -5.25, z: 0 }, axis: 'x', stop: -4.25 },
    { from: { x: 0, z: 0 }, to: { x: 5.25, z: 0 }, axis: 'x', stop: 4.25 },
    { from: { x: -2, z: 2 }, to: { x: -2, z: 3.95 }, axis: 'z', stop: 2.85 },
    { from: { x: 2, z: 2 }, to: { x: 2, z: 3.95 }, axis: 'z', stop: 2.85 },
    {
      from: { x: 5.2, z: -2.7 },
      to: { x: 5.2, z: -4.2 },
      axis: 'z',
      stop: -3.35,
    },
  ] as const)('respeita o móvel em $to', async ({ from, to, axis, stop }) => {
    const h = await harness();
    Object.assign(h.player(), from);
    for (let index = 0; index < 30; index++) h.move(to.x, to.z);
    expect(h.player()[axis]).toBeCloseTo(stop, 5);
  });

  it('limita teleporte e mantém ack, compatibilidade legada e rejeição de pacotes antigos', async () => {
    const h = await harness();
    const before = { x: h.player().x, z: h.player().z };
    h.move(10_000, 10_000);
    expect(distance(before, h.player())).toBeLessThanOrEqual(0.361);
    expect(h.player().moveSequence).toBe(1);
    const accepted = h.player().toJSON();
    for (const sequence of [0, 1, -1, 1.5, NaN, Infinity, '2']) {
      h.move(0, 0, { sequence });
      expect(h.player().toJSON()).toEqual(accepted);
    }
    h.send('move', h.clients[0], {
      x: h.player().x,
      z: h.player().z,
      dir: 0.8,
      moving: false,
    });
    expect(h.player()).toMatchObject({
      moveSequence: 1,
      dir: 0.8,
      moving: false,
    });
  });

  it.each([
    undefined,
    null,
    {},
    { x: NaN, z: 0 },
    { x: 0, z: Infinity },
    { x: '0', z: 0 },
  ])('ignora movimento inválido %j', async (payload) => {
    const h = await harness();
    const before = h.player().toJSON();
    h.send('move', h.clients[0], payload);
    expect(h.player().toJSON()).toEqual(before);
  });

  it('não aceita movimento de desconectado nem de remetente desconhecido', async () => {
    const h = await harness();
    h.player().connected = false;
    const before = h.player().toJSON();
    h.move(0, 0);
    h.send(
      'move',
      { sessionId: 'missing', send: jest.fn() } as unknown as TestClient,
      { x: 0, z: 0 },
    );
    expect(h.player().toJSON()).toEqual(before);
    expect(h.room.state.players.size).toBe(4);
  });

  it('começar teleporta ao escritório; reiniciar volta ao lobby sem carregar movimento nem perder microfone', async () => {
    const h = await harness();
    h.move(-1, -1, { crouching: true, airborne: true, elevation: 0.6 });
    h.start();
    expect(h.room.state.phase).toBe('jogando');
    for (const [index, client] of h.clients.entries())
      expect(h.player(client)).toMatchObject({
        ...OFFICE_MAP.spawns[index],
        moving: false,
        crouching: false,
        airborne: false,
        elevation: 0,
      });
    const sequence = h.player().moveSequence;
    h.move(h.player().x + 0.2, h.player().z);
    expect(h.player().moveSequence).toBe(sequence + 1);
    h.room.state.phase = 'fim';
    h.send('restart', h.clients[0]);
    expect(h.room.state.phase).toBe('lobby');
    for (const [index, client] of h.clients.entries())
      expect(h.player(client)).toMatchObject({
        ...LOBBY_MAP.spawns[index],
        moving: false,
        crouching: false,
        airborne: false,
        elevation: 0,
        ready: false,
        microphoneReady: true,
      });
    h.start();
    expect(h.room.state.phase).toBe('jogando');
    expect(h.player()).toMatchObject(OFFICE_MAP.spawns[0]);
  });

  it('andar no lobby não libera começar sem microfone ou prontidão', async () => {
    const h = await harness();
    h.move(0, 0);
    h.send('start', h.clients[0]);
    expect(h.room.state.phase).toBe('lobby');
    for (const client of h.clients)
      h.send('microphone:status', client, { ready: true });
    h.send('start', h.clients[0]);
    expect(h.room.state.phase).toBe('lobby');
    expect(h.clients[0].send).toHaveBeenLastCalledWith(
      'erro',
      expect.stringContaining('pronto'),
    );
  });

  it('não permite ações de partida durante o treino', async () => {
    const h = await harness();
    const before = h.player().toJSON();
    for (const [type, payload] of [
      ['sabotage', undefined],
      ['emergency', undefined],
      ['kill', { targetId: h.clients[1].sessionId }],
      ['vent', { ventId: OFFICE_MAP.vents[0].id }],
      ['task:begin', { spotId: OFFICE_MAP.taskSpots[0].id }],
    ] as const)
      h.send(type, h.clients[0], payload);
    expect(h.player().toJSON()).toEqual(before);
    expect(h.room.state.phase).toBe('lobby');
    expect(h.room.state.blackout).toBe(false);
    expect(h.clients[0].send).not.toHaveBeenCalledWith(
      'task:ok',
      expect.anything(),
    );
  });
});
