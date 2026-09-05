import { Client } from 'colyseus';
import { setGameDeps, GameDeps } from '../game-deps';
import { GameMapService } from '../game-map.service';
import { DeducaoRoom } from './deducao.room';
import { ConfigState, CorpseState } from './deducao.state';
import { OFFICE_MAP } from './map';
import { DEFAULT_CONFIG, MatchConfig, sanitizeConfig } from './rules';

jest.mock('colyseus', () =>
  process.getBuiltinModule('module').createRequire(__filename)('colyseus'),
);

type TestClient = Client & { send: jest.Mock };
type Handler = (client: Client, payload?: unknown) => void;
let now = 1_000_000;
const rooms: DeducaoRoom[] = [];

async function harness(config: Record<string, unknown> = {}, start = true) {
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
  let tick = () => {};
  jest.spyOn(room, 'setSimulationInterval').mockImplementation((callback) => {
    tick = () => callback(50);
  });
  jest.spyOn(room, 'setMetadata').mockResolvedValue(undefined);
  jest.spyOn(room, 'broadcast').mockImplementation(() => {});
  await room.onCreate({});
  const clients: TestClient[] = [];
  for (let index = 0; index < 7; index++) {
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
  send('config', clients[0], config);
  for (const client of clients)
    send('microphone:status', client, { ready: true });
  if (start) {
    for (const client of clients.slice(1)) send('ready', client);
    send('start', clients[0]);
    expect(room.state.phase).toBe('jogando');
  }
  const advance = (ms: number) => {
    now += ms;
    tick();
  };
  return {
    room,
    clients,
    host: clients[0],
    send,
    advance,
    player: (client: Client) => room.state.players.get(client.sessionId)!,
    atButton(client: Client) {
      const player = room.state.players.get(client.sessionId)!;
      player.x = OFFICE_MAP.emergency.x;
      player.z = OFFICE_MAP.emergency.z;
      player.level = OFFICE_MAP.emergency.level ?? 0;
    },
    finishMeeting() {
      advance(room.state.config.meetingSeconds * 1000);
      expect(room.state.phase).toBe('votacao');
      advance(room.state.config.voteSeconds * 1000);
      advance(6_000);
      expect(room.state.phase).toBe('jogando');
    },
  };
}

beforeEach(() => {
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  for (const room of rooms) {
    room.clock.stop();
    room.clock.clear();
  }
  rooms.length = 0;
  jest.restoreAllMocks();
});

describe('recarga do botão de emergência na sala real', () => {
  it('envia prazo global inicial e não gasta chamada antes do instante autorizado', async () => {
    const h = await harness();
    const readyAt = now + 30_000;
    expect(h.room.state.emergencyReadyAt).toBe(readyAt);
    for (const client of h.clients)
      expect(client.send).toHaveBeenLastCalledWith('emergency:status', {
        readyAt,
        serverNow: now,
        cooldownMs: 30_000,
      });
    h.atButton(h.host);
    h.advance(29_999);
    h.send('emergency', h.host, { readyAt: 0, cooldownMs: 0 });
    expect(h.room.state.phase).toBe('jogando');
    expect(h.player(h.host).emergenciesLeft).toBe(1);
    expect(h.host.send).toHaveBeenLastCalledWith('emergency:status', {
      readyAt,
      serverNow: now,
      cooldownMs: 30_000,
    });
    h.advance(1);
    h.send('emergency', h.host);
    expect(h.room.state.phase).toBe('reuniao');
    expect(h.room.state.emergencyReadyAt).toBe(0);
    expect(h.player(h.host).emergenciesLeft).toBe(0);
  });

  it('retornar da reunião recarrega para todos, sem gastar outra chamada com clique repetido', async () => {
    const h = await harness({
      emergencyPerPlayer: 3,
      emergencyCooldownMs: 10_000,
    });
    h.advance(10_000);
    h.atButton(h.host);
    h.send('emergency', h.host);
    h.send('emergency', h.host);
    expect(h.player(h.host).emergenciesLeft).toBe(2);
    h.finishMeeting();
    const readyAt = now + 10_000;
    expect(h.room.state.emergencyReadyAt).toBe(readyAt);
    for (const client of h.clients)
      expect(client.send).toHaveBeenLastCalledWith('emergency:status', {
        readyAt,
        serverNow: now,
        cooldownMs: 10_000,
      });
    const other = h.clients[1];
    h.atButton(other);
    h.advance(9_999);
    h.send('emergency', other);
    expect(h.room.state.phase).toBe('jogando');
    expect(h.player(other).emergenciesLeft).toBe(3);
    h.advance(1);
    h.send('emergency', other);
    expect(h.room.state.phase).toBe('reuniao');
    expect(h.player(other).emergenciesLeft).toBe(2);
  });

  it('reportar corpo ignora a recarga do botão e o retorno dessa reunião cria nova espera', async () => {
    const h = await harness();
    const player = h.player(h.host);
    const corpse = new CorpseState();
    Object.assign(corpse, {
      id: 'corpse',
      name: 'Colega',
      x: player.x,
      z: player.z,
      level: player.level,
    });
    h.room.state.corpses.push(corpse);
    h.advance(1_000);
    h.send('report', h.host, { corpseId: corpse.id });
    expect(h.room.state.phase).toBe('reuniao');
    expect(h.room.state.meeting.reason).toBe('corpo');
    expect(player.emergenciesLeft).toBe(1);
    expect(h.room.state.emergencyReadyAt).toBe(0);
    h.finishMeeting();
    expect(h.room.state.emergencyReadyAt).toBe(now + 30_000);
  });

  it.each([
    'morto',
    'desconectado',
    'duto',
    'longe',
    'outro-andar',
    'sem-chamadas',
    'sem-assento',
    'lobby',
    'reuniao',
    'votacao',
    'fim',
  ])('recusa %s sem consumir chamada ou modificar o prazo', async (reason) => {
    const h = await harness();
    h.advance(30_000);
    h.atButton(h.host);
    const player = h.player(h.host);
    if (reason === 'morto') player.alive = false;
    else if (reason === 'desconectado') player.connected = false;
    else if (reason === 'duto') player.inVent = true;
    else if (reason === 'longe') player.x += 3;
    else if (reason === 'outro-andar') player.level += 1;
    else if (reason === 'sem-chamadas') player.emergenciesLeft = 0;
    else if (reason === 'sem-assento')
      (h.room as unknown as { seats: Map<string, unknown> }).seats.delete(
        h.host.sessionId,
      );
    else h.room.state.phase = reason;
    const before = {
      phase: h.room.state.phase,
      left: player.emergenciesLeft,
      readyAt: h.room.state.emergencyReadyAt,
    };
    h.send('emergency', h.host);
    expect({
      phase: h.room.state.phase,
      left: player.emergenciesLeft,
      readyAt: h.room.state.emergencyReadyAt,
    }).toEqual(before);
  });

  it('não bloqueia o botão no apagão e a reunião restaura a iluminação', async () => {
    const h = await harness();
    h.advance(30_000);
    h.atButton(h.host);
    h.room.state.blackout = true;
    h.room.state.blackoutEndsAt = now + 25_000;
    h.send('emergency', h.host);
    expect(h.room.state.phase).toBe('reuniao');
    expect(h.room.state.blackout).toBe(false);
    expect(h.room.state.blackoutEndsAt).toBe(0);
  });

  it('preserva a cota individual mesmo depois de recargas e permite desabilitar chamadas', async () => {
    const h = await harness({
      emergencyPerPlayer: 3,
      emergencyCooldownMs: 10_000,
    });
    for (let left = 2; left >= 0; left--) {
      h.advance(10_000);
      h.atButton(h.host);
      h.send('emergency', h.host);
      expect(h.player(h.host).emergenciesLeft).toBe(left);
      h.finishMeeting();
    }
    h.advance(10_000);
    h.atButton(h.host);
    h.send('emergency', h.host);
    expect(h.room.state.phase).toBe('jogando');
    const disabled = await harness({ emergencyPerPlayer: 0 });
    disabled.advance(30_000);
    disabled.atButton(disabled.host);
    disabled.send('emergency', disabled.host);
    expect(disabled.room.state.phase).toBe('jogando');
    expect(disabled.player(disabled.host).emergenciesLeft).toBe(0);
  });

  it('reconecta com o mesmo prazo e pedido de status ignora dados fornecidos pelo cliente', async () => {
    const h = await harness();
    const readyAt = h.room.state.emergencyReadyAt;
    const client = h.clients[1];
    const back = {
      sessionId: client.sessionId,
      send: jest.fn(),
    } as unknown as TestClient;
    jest.spyOn(h.room, 'allowReconnection').mockResolvedValue(back);
    h.advance(5_000);
    await h.room.onLeave(client, 1006);
    expect(h.room.state.emergencyReadyAt).toBe(readyAt);
    expect(back.send).toHaveBeenCalledWith('emergency:status', {
      readyAt,
      serverNow: now,
      cooldownMs: 30_000,
    });
    expect(h.player(back).microphoneReady).toBe(false);
    h.send('emergency:status', back, {
      readyAt: 0,
      sessionId: h.host.sessionId,
    });
    expect(back.send).toHaveBeenLastCalledWith('emergency:status', {
      readyAt,
      serverNow: now,
      cooldownMs: 30_000,
    });
    const count = back.send.mock.calls.length;
    h.player(back).connected = false;
    h.send('emergency:status', back);
    expect(back.send).toHaveBeenCalledTimes(count);
    const unknown = {
      sessionId: 'missing',
      send: jest.fn(),
    } as unknown as TestClient;
    h.send('emergency:status', unknown);
    h.send('emergency', unknown);
    expect(unknown.send).not.toHaveBeenCalled();
  });

  it('fim e lobby limpam o prazo, e a próxima partida recebe recarga inicial nova', async () => {
    const h = await harness();
    h.room.state.tasksDone = h.room.state.tasksTotal;
    expect((h.room as unknown as { checkEnd(): boolean }).checkEnd()).toBe(
      true,
    );
    expect(h.room.state.emergencyReadyAt).toBe(0);
    h.send('restart', h.host);
    expect(h.room.state.emergencyReadyAt).toBe(0);
    expect(h.room.state.phase).toBe('lobby');
    h.advance(100_000);
    for (const client of h.clients.slice(1)) h.send('ready', client);
    h.send('start', h.host);
    expect(h.room.state.phase).toBe('jogando');
    expect(h.room.state.emergencyReadyAt).toBe(now + 30_000);
    expect(h.player(h.host).emergenciesLeft).toBe(1);
  });
});

describe('configuração validada do lobby', () => {
  it('schema e sanitização usam os mesmos padrões', () => {
    expect(new ConfigState().toJSON()).toEqual(DEFAULT_CONFIG);
    expect(sanitizeConfig(DEFAULT_CONFIG, 7)).toEqual(DEFAULT_CONFIG);
  });

  it('mantém visão interna em 11 e respeita limites novos sem alterar os demais', () => {
    const low = sanitizeConfig(
      {
        ...DEFAULT_CONFIG,
        emergencyCooldownMs: 0,
        emergencyPerPlayer: -1,
        visionRange: 99,
      },
      7,
    );
    const high = sanitizeConfig(
      {
        ...DEFAULT_CONFIG,
        emergencyCooldownMs: 999_999,
        emergencyPerPlayer: 99,
      },
      7,
    );
    expect(low.emergencyCooldownMs).toBe(10_000);
    expect(high.emergencyCooldownMs).toBe(60_000);
    expect(low.emergencyPerPlayer).toBe(0);
    expect(high.emergencyPerPlayer).toBe(3);
    expect(low.visionRange).toBe(11);
  });

  it.each([
    [4, 1],
    [7, 2],
    [10, 3],
  ])('limita assassinos a %s jogadores sem exceder %s', (count, maximum) => {
    expect(
      sanitizeConfig({ ...DEFAULT_CONFIG, killers: 3 }, count).killers,
    ).toBe(maximum);
  });

  it.each([NaN, Infinity, -Infinity, '40', null, undefined, true])(
    'valores numéricos inválidos %s voltam ao padrão na sanitização',
    (value) => {
      const config = { ...DEFAULT_CONFIG };
      for (const key of Object.keys(config) as (keyof MatchConfig)[]) {
        if (typeof config[key] === 'number')
          Object.assign(config, { [key]: value });
      }
      expect(sanitizeConfig(config, 7)).toEqual(DEFAULT_CONFIG);
    },
  );

  it('ignora valores inválidos e desconhecidos no handler, preservando a configuração anterior', async () => {
    const h = await harness({}, false);
    h.send('config', h.host, {
      emergencyCooldownMs: 45_000,
      blackoutSeconds: 40,
      withDetective: false,
      revealRoleOnEject: false,
    });
    const before = h.room.state.config.toJSON();
    h.send('config', h.host, {
      emergencyCooldownMs: NaN,
      blackoutSeconds: '55',
      killRange: Infinity,
      withDetective: 'true',
      revealRoleOnEject: 1,
      visionRange: 7,
      unknown: true,
    });
    expect(h.room.state.config.toJSON()).toEqual(before);
    h.send('config', h.host, null);
    h.send('config', h.host, 'invalid');
    expect(h.room.state.config.toJSON()).toEqual(before);
    h.send('config', h.host, {
      emergencyPerPlayer: 2,
      withDetective: true,
      revealRoleOnEject: true,
    });
    expect(h.room.state.config.emergencyPerPlayer).toBe(2);
    expect(h.room.state.config.withDetective).toBe(true);
    expect(h.room.state.config.revealRoleOnEject).toBe(true);
  });

  it('só aceita configuração do anfitrião no lobby', async () => {
    const h = await harness({}, false);
    h.send('config', h.clients[1], { emergencyCooldownMs: 60_000 });
    expect(h.room.state.config.emergencyCooldownMs).toBe(30_000);
    h.send('config', h.host, { emergencyCooldownMs: 20_000 });
    for (const client of h.clients.slice(1)) h.send('ready', client);
    h.send('start', h.host);
    h.send('config', h.host, { emergencyCooldownMs: 60_000 });
    expect(h.room.state.config.emergencyCooldownMs).toBe(20_000);
    expect(h.room.state.emergencyReadyAt).toBe(now + 20_000);
  });
});
