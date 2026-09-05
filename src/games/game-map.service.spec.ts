import { NotFoundException } from '@nestjs/common';
import { OFFICE_MAP } from './deducao/map';
import { PRIMARY_MAP_ID } from './deducao/maps';
import { GameMapService } from './game-map.service';

describe('GameMapService', () => {
  const service = new GameMapService();

  it('lista o mapa principal versionado no repositório', async () => {
    await expect(service.list()).resolves.toEqual([
      {
        id: PRIMARY_MAP_ID,
        name: OFFICE_MAP.name,
        original: true,
        updatedAt: null,
      },
    ]);
  });

  it('usa o mapa principal quando nenhum id é informado', async () => {
    await expect(service.get()).resolves.toMatchObject({
      id: PRIMARY_MAP_ID,
      map: OFFICE_MAP,
    });
  });

  it.each(['', '   ', ' original '])(
    'resolve o id %j para a mesma instância do mapa oficial',
    async (id) => {
      const entry = await service.get(id);
      expect(entry.id).toBe(PRIMARY_MAP_ID);
      expect(entry.map).toBe(OFFICE_MAP);
    },
  );

  it('entrega a mesma definição no endpoint do mapa atual', async () => {
    await expect(service.current()).resolves.toBe(OFFICE_MAP);
  });

  it('recusa um mapa que não foi registrado no código', async () => {
    await expect(service.get('nao-existe')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
