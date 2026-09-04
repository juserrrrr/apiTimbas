import type { WallBox } from './map';

/// Movimento e visão do jogo, sem I/O nenhum. O servidor é quem manda: o
/// navegador envia para onde quer ir, e é aqui que a jogada vira posição legal.

export interface Vec2 {
  x: number;
  z: number;
}

export const PLAYER_RADIUS = 0.45;

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/// Corta o passo no que o tempo decorrido permite andar. Sem isto, um cliente
/// alterado pediria para atravessar o mapa inteiro em um quadro.
export function clampStep(from: Vec2, to: Vec2, maxDistance: number): Vec2 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length <= maxDistance || length === 0) return { x: to.x, z: to.z };
  const scale = maxDistance / length;
  return { x: from.x + dx * scale, z: from.z + dz * scale };
}

function overlaps(point: Vec2, box: WallBox, radius: number): boolean {
  return (
    point.x > box.minX - radius &&
    point.x < box.maxX + radius &&
    point.z > box.minZ - radius &&
    point.z < box.maxZ + radius
  );
}

/// Empurra o jogador para fora da parede pelo lado mais próximo. Resolver um
/// eixo de cada vez é o que faz o corpo deslizar pela parede em vez de grudar
/// nela quando alguém anda na diagonal contra o canto.
function pushOut(point: Vec2, box: WallBox, radius: number): Vec2 {
  const left = point.x - (box.minX - radius);
  const right = box.maxX + radius - point.x;
  const up = point.z - (box.minZ - radius);
  const down = box.maxZ + radius - point.z;
  const smallest = Math.min(left, right, up, down);

  if (smallest === left) return { x: box.minX - radius, z: point.z };
  if (smallest === right) return { x: box.maxX + radius, z: point.z };
  if (smallest === up) return { x: point.x, z: box.minZ - radius };
  return { x: point.x, z: box.maxZ + radius };
}

export function resolveCollisions(
  point: Vec2,
  walls: WallBox[],
  radius = PLAYER_RADIUS,
): Vec2 {
  let resolved = { x: point.x, z: point.z };
  // Duas passadas: sair de uma parede pode encostar na vizinha, e no vão da
  // porta isso acontece o tempo todo.
  for (let pass = 0; pass < 2; pass += 1) {
    let touched = false;
    for (const wall of walls) {
      if (!overlaps(resolved, wall, radius)) continue;
      resolved = pushOut(resolved, wall, radius);
      touched = true;
    }
    if (!touched) break;
  }
  return resolved;
}

function moveAxis(
  point: Vec2,
  delta: number,
  axis: 'x' | 'z',
  walls: WallBox[],
  radius: number,
): Vec2 {
  if (delta === 0) return point;
  const next = { x: point.x, z: point.z };
  next[axis] += delta;

  for (const wall of walls) {
    if (!overlaps(next, wall, radius)) continue;
    if (axis === 'x') {
      next.x = delta > 0 ? wall.minX - radius : wall.maxX + radius;
    } else {
      next.z = delta > 0 ? wall.minZ - radius : wall.maxZ + radius;
    }
  }
  return next;
}

/// O passo é percorrido em pedaços menores que o corpo do jogador, cada um
/// resolvido a partir de onde o anterior parou. Empurrar só o ponto final não
/// bastava: com a rede engasgada o passo fica grande o suficiente para começar
/// de um lado da parede e terminar do outro, sem nunca encostar nela.
export function moveTowards(
  from: Vec2,
  to: Vec2,
  maxDistance: number,
  walls: WallBox[],
  radius = PLAYER_RADIUS,
): Vec2 {
  const target = clampStep(from, to, maxDistance);
  const steps = Math.max(1, Math.ceil(distance(from, target) / (radius * 0.8)));
  const stepX = (target.x - from.x) / steps;
  const stepZ = (target.z - from.z) / steps;

  let current = resolveCollisions(from, walls, radius);
  for (let step = 0; step < steps; step += 1) {
    current = moveAxis(current, stepX, 'x', walls, radius);
    current = moveAxis(current, stepZ, 'z', walls, radius);
  }
  return current;
}

function segmentHitsBox(from: Vec2, to: Vec2, box: WallBox): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  let entry = 0;
  let exit = 1;

  for (const axis of ['x', 'z'] as const) {
    const origin = axis === 'x' ? from.x : from.z;
    const delta = axis === 'x' ? dx : dz;
    const min = axis === 'x' ? box.minX : box.minZ;
    const max = axis === 'x' ? box.maxX : box.maxZ;

    if (Math.abs(delta) < 1e-8) {
      if (origin < min || origin > max) return false;
      continue;
    }
    const first = (min - origin) / delta;
    const second = (max - origin) / delta;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (entry > exit) return false;
  }
  return true;
}

/// Enxerga daqui até ali? Vale para ações de alcance, como abate e tarefa. Os
/// jogadores continuam renderizados mesmo quando uma parede bloqueia a ação.
export function hasLineOfSight(
  from: Vec2,
  to: Vec2,
  walls: WallBox[],
): boolean {
  return !walls.some((wall) => segmentHitsBox(from, to, wall));
}

export function isWithin(
  from: Vec2,
  to: Vec2,
  range: number,
  walls: WallBox[],
): boolean {
  return distance(from, to) <= range && hasLineOfSight(from, to, walls);
}
