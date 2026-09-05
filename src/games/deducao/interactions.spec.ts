import { Client } from 'colyseus';
import { setGameDeps, GameDeps } from '../game-deps';
import { GameMapService } from '../game-map.service';
import { DeducaoRoom } from './deducao.room';
import { OFFICE_MAP, type TaskSpot } from './map';
import { minTaskDurationMs } from './tasks';

jest.mock('colyseus', () =>
  process.getBuiltinModule('module').createRequire(__filename)('colyseus'),
);
type TestClient = Client & { send: jest.Mock };
type Handler = (client: Client, payload?: unknown) => void;
const rooms: DeducaoRoom[] = [];

async function harness() {
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
  for (let index = 0; index < 8; index++) {
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
  const send = (type: string, client: Client, payload?: unknown) =>
    handlers.get(type)!(client, payload);
  const internals = room as unknown as {
    seats: Map<
      string,
      {
        role: string;
        tasks: { spotId: string; done: boolean }[];
        activeTask: {
          spotId: string;
          requestId?: string;
          startedAt: number;
        } | null;
        forensicReadyAt: number;
        inspectedCorpseIds: Set<string>;
      }
    >;
    officeMap: typeof OFFICE_MAP;
    deathEvidence: Map<string, unknown>;
  };
  for (const client of clients) {
    send('microphone:status', client, { ready: true });
    send('ready', client);
  }
  send('start', clients[0]);
  const player = (client: Client) => room.state.players.get(client.sessionId)!;
  const seat = (client: Client) => internals.seats.get(client.sessionId)!;
  const detective = clients.find((client) => seat(client).role === 'detetive')!;
  const killer = clients.find((client) => seat(client).role === 'assassino')!;
  const crew = clients.filter((client) => seat(client).role === 'funcionario');
  for (const client of clients) client.send.mockClear();
  return {
    room,
    clients,
    send,
    player,
    seat,
    detective,
    killer,
    crew,
    internals,
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
    clear() {
      for (const client of clients) client.send.mockClear();
    },
    assign(spot: TaskSpot, client = crew[0]) {
      seat(client).tasks = [{ spotId: spot.id, done: false }];
      Object.assign(player(client), {
        x: spot.x,
        z: spot.z,
        level: spot.level ?? 0,
      });
    },
    kill(victim = crew[1], blackout = false) {
      now += 40_001;
      const at = { x: 23, z: 19, level: 0 };
      Object.assign(player(killer), at);
      Object.assign(player(victim), { ...at, x: at.x + 0.5 });
      if (blackout) send('sabotage', killer);
      send('kill', killer, { targetId: victim.sessionId });
      const corpse = room.state.corpses.at(-1)!;
      expect(corpse).toBeDefined();
      Object.assign(player(detective), {
        x: corpse.x,
        z: corpse.z + 0.7,
        level: corpse.level,
      });
      return corpse;
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

describe('ACK autoritativo de tarefa', () => {
  it.each(['curta', 'media', 'longa'] as const)(
    'confirma abertura e só conclui %s depois do mínimo de servidor',
    async (duration) => {
      const h = await harness();
      const spot = OFFICE_MAP.taskSpots.find(
        (candidate) => candidate.duration === duration,
      )!;
      const client = h.crew[0];
      h.assign(spot);
      const payload = { spotId: spot.id, requestId: 'opening-1' };
      h.send('task:begin', client, payload);
      expect(client.send).toHaveBeenLastCalledWith('task:ok', {
        ...payload,
        kind: spot.kind,
        label: spot.label,
        duration,
        minDurationMs: minTaskDurationMs(spot),
      });
      h.advance(minTaskDurationMs(spot) - 1);
      h.send('task:done', client, payload);
      expect(client.send).toHaveBeenLastCalledWith('task:rejected', {
        ...payload,
        reason: expect.any(String),
        retryAfterMs: 1,
      });
      expect(h.player(client).tasksDone).toBe(0);
      h.advance(1);
      h.send('task:done', client, payload);
      expect(client.send).toHaveBeenLastCalledWith('task:completed', payload);
      expect(h.player(client).tasksDone).toBe(1);
      h.send('task:done', client, { ...payload, requestId: 'repeat' });
      expect(client.send).toHaveBeenLastCalledWith('task:completed', {
        ...payload,
        requestId: 'repeat',
      });
      expect(h.player(client).tasksDone).toBe(1);
    },
  );

  it('preserva abertura repetida por requestId e ignora conclusão velha após reabrir', async () => {
    const h = await harness();
    const spot = OFFICE_MAP.taskSpots[0];
    const client = h.crew[0];
    h.assign(spot);
    h.send('task:begin', client, { spotId: spot.id, requestId: 'old' });
    const startedAt = h.seat(client).activeTask!.startedAt;
    h.advance(100);
    h.send('task:begin', client, { spotId: spot.id, requestId: 'old' });
    expect(h.seat(client).activeTask!.startedAt).toBe(startedAt);
    h.send('task:begin', client, { spotId: spot.id, requestId: 'new' });
    h.advance(7_000);
    h.send('task:done', client, { spotId: spot.id, requestId: 'old' });
    expect(client.send).toHaveBeenLastCalledWith(
      'task:rejected',
      expect.objectContaining({ requestId: 'old' }),
    );
    expect(h.player(client).tasksDone).toBe(0);
    h.send('task:done', client, { spotId: spot.id });
    expect(h.player(client).tasksDone).toBe(0);
    h.send('task:done', client, { spotId: spot.id, requestId: 'new' });
    expect(h.player(client).tasksDone).toBe(1);
  });

  it('mantém cliente legado, duração ausente curta e qualquer ordem de execução', async () => {
    const h = await harness();
    const [first, second] = OFFICE_MAP.taskSpots;
    const client = h.crew[0];
    h.assign(second);
    h.seat(client).tasks.unshift({ spotId: first.id, done: false });
    h.send('task:begin', client, { spotId: second.id });
    h.advance(7_000);
    h.send('task:done', client, { spotId: second.id });
    expect(client.send).toHaveBeenLastCalledWith('task:completed', {
      spotId: second.id,
    });
    expect(h.seat(client).tasks[0].done).toBe(false);
    expect(minTaskDurationMs({})).toBe(1_200);
  });

  it.each([
    'connected',
    'inVent',
    'phase',
    'level',
    'distance',
    'wall',
  ] as const)(
    'rejeita abertura e conclusão por %s sem ACK de sucesso',
    async (gate) => {
      const h = await harness();
      const spot = OFFICE_MAP.taskSpots[0];
      const client = h.crew[0];
      h.assign(spot);
      const payload = { spotId: spot.id, requestId: 'request' };
      h.send('task:begin', client, payload);
      h.advance(7_000);
      h.clear();
      if (gate === 'connected') h.player(client).connected = false;
      if (gate === 'inVent') h.player(client).inVent = true;
      if (gate === 'phase') h.room.state.phase = 'reuniao';
      if (gate === 'level') h.player(client).level = 1;
      if (gate === 'distance') h.player(client).x += 3;
      if (gate === 'wall') {
        h.player(client).x += 1;
        h.internals.officeMap = {
          ...OFFICE_MAP,
          walls: [
            ...OFFICE_MAP.walls,
            {
              minX: spot.x + 0.45,
              maxX: spot.x + 0.55,
              minZ: spot.z - 2,
              maxZ: spot.z + 2,
              level: 0,
            },
          ],
        };
      }
      h.send('task:done', client, payload);
      h.send('task:begin', client, payload);
      expect(client.send.mock.calls.map(([type]) => type)).toEqual([
        'task:rejected',
        'task:rejected',
      ]);
      expect(h.player(client).tasksDone).toBe(0);
    },
  );

  it('não expõe tarefa alheia e rejeita payload/abertura inválidos', async () => {
    const h = await harness();
    const spot = OFFICE_MAP.taskSpots[0];
    const client = h.crew[0];
    h.assign(spot);
    for (const payload of [
      null,
      {},
      { spotId: spot.id, requestId: 5 },
      { spotId: spot.id, requestId: '' },
      { spotId: spot.id, requestId: 'a'.repeat(101) },
      { spotId: 'not-owned', requestId: 'valid' },
    ]) {
      h.send('task:begin', client, payload);
      h.send('task:done', client, payload);
    }
    h.send('task:done', client, { spotId: spot.id, requestId: 'never-opened' });
    expect(
      client.send.mock.calls.every(([type]) => type === 'task:rejected'),
    ).toBe(true);
    for (const [, payload] of client.send.mock.calls)
      expect(
        Object.keys(payload).every((key) =>
          ['spotId', 'requestId', 'reason'].includes(key),
        ),
      ).toBe(true);
    expect(h.player(client).tasksDone).toBe(0);
  });

  it('mantém a exceção de conclusão remota do fantasma e não conta tarefa falsa do assassino', async () => {
    const h = await harness();
    const spot = OFFICE_MAP.taskSpots[0];
    const client = h.crew[0];
    h.assign(spot);
    h.send('task:begin', client, { spotId: spot.id });
    h.advance(7_000);
    Object.assign(h.player(client), { alive: false, x: 0, z: 0, level: 1 });
    h.send('task:done', client, { spotId: spot.id });
    expect(h.player(client).tasksDone).toBe(1);
    const total = h.room.state.tasksDone;
    h.assign(spot, h.killer);
    h.send('task:begin', h.killer, { spotId: spot.id });
    h.advance(7_000);
    h.send('task:done', h.killer, { spotId: spot.id });
    expect(h.player(h.killer).tasksDone).toBe(1);
    expect(h.room.state.tasksDone).toBe(total);
  });

  it('envia completed antes do fim ao concluir a última tarefa', async () => {
    const h = await harness();
    const spot = OFFICE_MAP.taskSpots[0];
    const client = h.crew[0];
    h.assign(spot);
    const order: string[] = [];
    client.send.mockImplementation((type: string) => order.push(type));
    jest.spyOn(h.room, 'broadcast').mockImplementation(((type: string) => {
      order.push(type);
    }) as typeof h.room.broadcast);
    h.room.state.tasksDone = h.room.state.tasksTotal - 1;
    h.send('task:begin', client, { spotId: spot.id });
    h.advance(7_000);
    h.send('task:done', client, { spotId: spot.id });
    expect(h.room.state.phase).toBe('fim');
    expect(order.indexOf('task:completed')).toBeLessThan(order.indexOf('fim'));
  });
});

describe('perícia privada do detetive', () => {
  it.each([false, true])('preserva anonimato na mensagem de morte com apagão %s', async (blackout) => {
    const h = await harness();
    h.kill(h.crew[1], blackout);
    expect(h.crew[1].send).toHaveBeenCalledWith('morte', {
      by: blackout ? 'Alguém no apagão' : h.player(h.killer).name,
    });
  });

  it.each([
    [0, 'recente'],
    [14_999, 'recente'],
    [15_000, 'intermediario'],
    [44_999, 'intermediario'],
    [45_000, 'antigo'],
  ] as const)(
    'estima idade em %sms sem expor quem matou',
    async (age, ageBand) => {
      const h = await harness();
      const corpse = h.kill(undefined, true);
      h.advance(age);
      h.room.state.blackout = false;
      h.clear();
      h.send('forensic:inspect', h.detective, { corpseId: corpse.id });
      expect(h.detective.send).toHaveBeenCalledWith('forensic:result', {
        corpseId: corpse.id,
        ageBand,
        blackout: true,
      });
      expect(h.detective.send).toHaveBeenLastCalledWith('forensic:status', {
        readyAt: h.now() + 30_000,
        serverNow: h.now(),
        cooldownMs: 30_000,
        inspectedCorpseIds: [corpse.id],
      });
      for (const client of h.clients.filter(
        (candidate) => candidate !== h.detective,
      ))
        expect(client.send).not.toHaveBeenCalled();
      expect(Object.keys(corpse.toJSON()).sort()).toEqual(
        [
          'id',
          'playerId',
          'name',
          'color',
          'x',
          'z',
          'reported',
          'level',
        ].sort(),
      );
    },
  );

  it('não entrega status nem pistas a funcionário/assassino ou detetive desconectado', async () => {
    const h = await harness();
    const corpse = h.kill();
    h.clear();
    for (const client of [h.crew[0], h.killer]) {
      h.send('forensic:status', client);
      h.send('forensic:inspect', client, { corpseId: corpse.id });
      expect(client.send).not.toHaveBeenCalled();
    }
    h.player(h.detective).connected = false;
    h.send('forensic:status', h.detective);
    h.send('forensic:inspect', h.detective, { corpseId: corpse.id });
    expect(h.detective.send).not.toHaveBeenCalled();
  });

  it.each([
    'alive',
    'inVent',
    'phase',
    'level',
    'distance',
    'wall',
    'reported',
    'missing',
  ] as const)('não cobra perícia recusada por %s', async (gate) => {
    const h = await harness();
    const corpse = h.kill();
    h.clear();
    if (gate === 'alive') h.player(h.detective).alive = false;
    if (gate === 'inVent') h.player(h.detective).inVent = true;
    if (gate === 'phase') h.room.state.phase = 'reuniao';
    if (gate === 'level') h.player(h.detective).level = 1;
    if (gate === 'distance') h.player(h.detective).z += 5;
    if (gate === 'reported') corpse.reported = true;
    if (gate === 'wall')
      h.internals.officeMap = {
        ...OFFICE_MAP,
        walls: [
          ...OFFICE_MAP.walls,
          {
            minX: corpse.x - 2,
            maxX: corpse.x + 2,
            minZ: corpse.z + 0.3,
            maxZ: corpse.z + 0.4,
          },
        ],
      };
    h.send('forensic:inspect', h.detective, {
      corpseId: gate === 'missing' ? 'not-a-corpse' : corpse.id,
    });
    expect(h.detective.send).toHaveBeenCalledWith('forensic:rejected', {
      reason: expect.any(String),
    });
    expect(h.seat(h.detective).forensicReadyAt).toBe(0);
    expect(h.seat(h.detective).inspectedCorpseIds.size).toBe(0);
  });

  it('impõe recarga e uma leitura por corpo, preservando status na reconexão e limpando no restart', async () => {
    const h = await harness();
    const first = h.kill(h.crew[1]);
    const second = h.kill(h.crew[2]);
    h.send('forensic:inspect', h.detective, { corpseId: first.id });
    const readyAt = h.seat(h.detective).forensicReadyAt;
    h.clear();
    h.send('forensic:inspect', h.detective, { corpseId: second.id });
    expect(h.detective.send).toHaveBeenCalledWith('forensic:rejected', {
      reason: expect.stringContaining('recarga'),
    });
    expect(h.seat(h.detective).forensicReadyAt).toBe(readyAt);
    h.advance(30_000);
    h.clear();
    h.send('forensic:inspect', h.detective, { corpseId: first.id });
    expect(h.detective.send).toHaveBeenCalledWith('forensic:rejected', {
      reason: expect.stringContaining('já periciou'),
    });
    expect(h.seat(h.detective).forensicReadyAt).toBe(readyAt);
    h.send('forensic:inspect', h.detective, { corpseId: second.id });
    expect(h.seat(h.detective).inspectedCorpseIds.size).toBe(2);
    jest.spyOn(h.room, 'allowReconnection').mockResolvedValue(h.detective);
    h.clear();
    await h.room.onLeave(h.detective);
    expect(h.detective.send).toHaveBeenCalledWith(
      'forensic:status',
      expect.objectContaining({
        inspectedCorpseIds: [first.id, second.id],
        readyAt: h.seat(h.detective).forensicReadyAt,
      }),
    );
    h.room.state.phase = 'fim';
    h.send('restart', h.clients[0]);
    expect(h.internals.deathEvidence.size).toBe(0);
    expect(h.seat(h.detective).inspectedCorpseIds.size).toBe(0);
    expect(h.seat(h.detective).forensicReadyAt).toBe(0);
  });

  it('mantém a investigação de reunião e entrega somente na reunião seguinte', async () => {
    const h = await harness();
    h.room.state.phase = 'reuniao';
    h.clear();
    h.send('inspect', h.detective, { targetId: h.killer.sessionId });
    expect(h.detective.send).toHaveBeenLastCalledWith('investigacao', {
      status: 'anotado',
      name: h.player(h.killer).name,
    });
    h.send('inspect', h.detective, { targetId: h.crew[0].sessionId });
    expect(h.detective.send).toHaveBeenCalledTimes(1);
    h.room.state.phase = 'jogando';
    h.advance(40_000);
    Object.assign(h.player(h.detective), OFFICE_MAP.emergency);
    h.send('emergency', h.detective);
    expect(h.detective.send).toHaveBeenCalledWith('investigacao', {
      status: 'suspeito',
      name: h.player(h.killer).name,
    });
    for (const client of h.clients.filter(
      (candidate) => candidate !== h.detective,
    ))
      expect(client.send).not.toHaveBeenCalledWith(
        'investigacao',
        expect.anything(),
      );
  });
});
