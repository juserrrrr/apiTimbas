import { OFFICE_MAP, buildObstacles, roomAt } from './map';

const inRoom = (id: string) =>
  OFFICE_MAP.props.filter(
    (prop) => roomAt(prop.x, prop.z, prop.level ?? 0)?.id === id,
  );

describe('escritório compacto sem mobiliário solto', () => {
  it('conserva aproximadamente três quartos da área anterior sem excluir ambientes', () => {
    expect(OFFICE_MAP.bounds.w).toBeCloseTo(56.32);
    expect(OFFICE_MAP.bounds.d).toBeCloseTo(44.48);
    const area = OFFICE_MAP.rooms.reduce(
      (total, room) => total + room.rect.w * room.rect.d,
      0,
    );
    expect(area / 4357.7856).toBeCloseTo((0.74 / 0.84) ** 2, 8);
    expect(OFFICE_MAP.rooms).toHaveLength(21);
    expect(OFFICE_MAP.taskSpots).toHaveLength(55);
    expect(OFFICE_MAP.vents).toHaveLength(5);
    for (const room of OFFICE_MAP.rooms) {
      for (const door of room.doors) expect(door.width).toBeGreaterThan(1.5);
    }
  });

  it('retira quinze cadeiras e quarenta e quatro objetos redundantes', () => {
    expect(OFFICE_MAP.props).toHaveLength(133);
    expect(
      OFFICE_MAP.props.filter((prop) => prop.kind === 'chair'),
    ).toHaveLength(32);
    expect(
      OFFICE_MAP.props.filter((prop) => prop.kind === 'diningChair'),
    ).toHaveLength(6);
    expect(
      OFFICE_MAP.props.filter((prop) => prop.kind === 'arcade'),
    ).toHaveLength(1);
    expect(
      OFFICE_MAP.props.filter((prop) => prop.kind === 'crate'),
    ).toHaveLength(1);
    for (const id of ['hall-central', 'hall-superior', 'terraco', 'copa']) {
      expect(inRoom(id).some((prop) => prop.kind === 'chair')).toBe(false);
    }
    expect(
      inRoom('conselho').filter((prop) => prop.kind === 'chair'),
    ).toHaveLength(6);
  });

  it.each(['openspace', 'operacoes'])(
    'organiza seis estações completas em %s',
    (id) => {
      const props = inRoom(id);
      const desks = props.filter((prop) => prop.kind === 'desk');
      const monitors = props.filter((prop) => prop.kind === 'monitor');
      const chairs = props.filter((prop) => prop.kind === 'chair');
      expect(desks).toHaveLength(6);
      expect(monitors).toHaveLength(6);
      expect(chairs).toHaveLength(6);
      for (const desk of desks) {
        const monitor = monitors.filter(
          (prop) => Math.abs(prop.x - desk.x) < 1e-8,
        );
        const chair = chairs.filter(
          (prop) =>
            Math.abs(prop.x - desk.x) < 1e-8 && Math.abs(prop.z - desk.z) < 2,
        );
        expect(
          monitor.filter((prop) => Math.abs(prop.z - desk.z) < 0.4),
        ).toHaveLength(1);
        expect(chair).toHaveLength(1);
        expect(Math.abs(chair[0].z - desk.z)).toBeCloseTo(1.0752);
      }
    },
  );

  it('faz todas as cadeiras de escritório olharem para uma mesa do mesmo cômodo', () => {
    for (const chair of OFFICE_MAP.props.filter(
      (prop) => prop.kind === 'chair',
    )) {
      const room = roomAt(chair.x, chair.z, chair.level ?? 0)!;
      const kind = ['reuniao', 'conselho'].includes(room.id)
        ? 'meetingTable'
        : 'desk';
      const tables = inRoom(room.id).filter((prop) => prop.kind === kind);
      expect(tables.length).toBeGreaterThan(0);
      const table = tables.sort(
        (a, b) =>
          Math.hypot(a.x - chair.x, a.z - chair.z) -
          Math.hypot(b.x - chair.x, b.z - chair.z),
      )[0];
      const [box] = buildObstacles([table]);
      const dx = Math.max(box.minX, Math.min(box.maxX, chair.x)) - chair.x;
      const dz = Math.max(box.minZ, Math.min(box.maxZ, chair.z)) - chair.z;
      expect(Math.hypot(dx, dz)).toBeGreaterThan(0.3);
      expect(
        (dx * Math.sin(chair.rot) + dz * Math.cos(chair.rot)) /
          Math.hypot(dx, dz),
      ).toBeCloseTo(1, 6);
    }
  });

  it('preserva os doze lugares reais da reunião e suas direções', () => {
    const chairs = inRoom('reuniao').filter((prop) => prop.kind === 'chair');
    expect(chairs).toHaveLength(12);
    expect(OFFICE_MAP.meetingSeats).toHaveLength(12);
    for (const seat of OFFICE_MAP.meetingSeats) {
      expect(
        chairs.some(
          (chair) =>
            Math.hypot(chair.x - seat.x, chair.z - seat.z) < 1e-8 &&
            Math.abs(chair.rot - seat.dir) < 1e-8,
        ),
      ).toBe(true);
    }
  });
});
