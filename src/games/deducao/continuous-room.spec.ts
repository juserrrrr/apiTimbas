import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { OFFICE_MAP, collidersFor, stairProgressAt } from './map';
import { moveTowards } from './movement';

interface TestPlayer {
  x: number;
  z: number;
  level: number;
  alive: boolean;
  inVent: boolean;
}

interface MovementContext {
  state: { players: Map<string, TestPlayer> };
  seats: Map<string, { lastMoveAt: number; activeTask: object | null }>;
  officeMap: typeof OFFICE_MAP;
  isPlayable: () => boolean;
  onMove: (
    client: { sessionId: string; send: jest.Mock },
    payload: { x: number; z: number; dir: number; moving: boolean },
  ) => void;
}

// Executa o handler real sem inicializar a rede Colyseus nem serviços externos.
const path = join(__dirname, 'deducao.room.ts');
const source = ts.createSourceFile(
  path,
  readFileSync(path, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const room = source.statements.find(
  (node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === 'DeducaoRoom',
)!;
const method = room.members.find(
  (node) =>
    ts.isMethodDeclaration(node) && node.name.getText(source) === 'onMove',
)!;
const code = ts.transpileModule(
  `class MovementRoom { ${method.getText(source)} } module.exports = MovementRoom;`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
    },
  },
).outputText;

function harness(position: { x: number; z: number; level: number }) {
  let now = 0;
  const module = { exports: undefined as unknown };
  runInNewContext(code, {
    module,
    Date: { now: () => now },
    WALK_SPEED: 4.6,
    RUN_SPEED: 7.1,
    SPEED_TOLERANCE: 1.35,
    moveTowards,
    collidersFor,
    stairProgressAt,
  });
  const Constructor = module.exports as new () => MovementContext;
  const context = new Constructor();
  const player = { ...position, alive: true, inVent: false };
  const seat = {
    lastMoveAt: 0,
    activeTask: { spotId: 'test' } as object | null,
  };
  const client = { sessionId: 'player', send: jest.fn() };
  Object.assign(context, {
    state: { players: new Map([[client.sessionId, player]]) },
    seats: new Map([[client.sessionId, seat]]),
    officeMap: OFFICE_MAP,
    isPlayable: () => true,
  });
  return {
    context,
    player,
    client,
    seat,
    move(x: number, z: number) {
      now += 50;
      context.onMove(client, { x, z, dir: 0, moving: true });
    },
  };
}

describe('prédio contínuo no handler de movimento', () => {
  it.each([false, true])(
    'atravessa a escada sem mensagem nem teleporte (descida: %s)',
    (descending) => {
      const stair = OFFICE_MAP.stairs[0];
      const route = [
        { x: stair.x, z: stair.z },
        { x: stair.turnX!, z: stair.turnZ! },
        { x: stair.targetX, z: stair.targetZ },
      ];
      if (descending) route.reverse();
      const h = harness({ ...route[0], level: descending ? 1 : 0 });
      const levels = [h.player.level];
      for (const target of route.slice(1)) {
        for (let step = 0; step < 200; step++) {
          if (Math.hypot(h.player.x - target.x, h.player.z - target.z) < 0.001)
            break;
          const previous = { ...h.player };
          h.move(target.x, target.z);
          expect(
            Math.hypot(h.player.x - previous.x, h.player.z - previous.z),
          ).toBeLessThanOrEqual(0.361);
          if (h.player.level !== levels.at(-1)) levels.push(h.player.level);
        }
        expect(h.player.x).toBeCloseTo(target.x, 5);
        expect(h.player.z).toBeCloseTo(target.z, 5);
      }
      expect(levels).toEqual(descending ? [1, 0] : [0, 1]);
      expect(h.seat.activeTask).toBeNull();
      expect(h.client.send).not.toHaveBeenCalled();
    },
  );

  it('conserva a colisão e o limite de velocidade fora da escada', () => {
    const h = harness({ ...OFFICE_MAP.spawns[0], level: 0 });
    const previous = { ...h.player };
    h.move(10_000, 10_000);
    expect(
      Math.hypot(h.player.x - previous.x, h.player.z - previous.z),
    ).toBeLessThanOrEqual(0.361);
    expect(h.player.level).toBe(0);
    expect(h.client.send).not.toHaveBeenCalled();
    expect(h.seat.activeTask).not.toBeNull();
  });

  it('ignora coordenadas inválidas sem mudar o estado ou notificar', () => {
    const h = harness({ ...OFFICE_MAP.spawns[0], level: 0 });
    const previous = { ...h.player };
    h.move('100' as unknown as number, 0);
    expect(h.player).toEqual(previous);
    expect(h.client.send).not.toHaveBeenCalled();
  });
});
