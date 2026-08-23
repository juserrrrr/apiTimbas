import { ConflictException } from '@nestjs/common';
import { Client } from 'discord.js';
import { AccessService } from '../access/access.service';
import { Role } from '../enums/role.enum';
import { PrismaService } from '../prisma/prisma.service';
import { LivekitService } from './livekit.service';
import { RequestUser, StreamingService } from './streaming.service';

describe('StreamingService host sessions', () => {
  const host: RequestUser = {
    id: 1,
    name: 'Host',
    role: Role.PLAYER,
    avatar: null,
    discordId: 'host-discord',
  };

  const createService = (persisted: object[] = []) => {
    const prisma = {
      activeStream: {
        findMany: jest.fn().mockResolvedValue(persisted),
        create: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaService;
    const livekit = {
      isConfigured: jest.fn().mockResolvedValue(false),
      isEnabled: jest.fn().mockResolvedValue(false),
      closeRoom: jest.fn().mockResolvedValue(undefined),
    } as unknown as LivekitService;
    return new StreamingService(
      {} as AccessService,
      prisma,
      {} as Client,
      livekit,
    );
  };

  it('mantém o host atual quando o estúdio é aberto em outra aba', async () => {
    const service = createService();
    const stream = await service.create(host, 'Live', 'guild-1', 'MEMBERS');
    const current = service.join(stream.id, host, 'first-tab');
    service.attach(stream.id, current.peerId);

    expect(() => service.join(stream.id, host, 'second-tab')).toThrow(
      ConflictException,
    );
    expect(service.createTicket(stream.id, current.peerId, host)).toEqual({
      ticket: expect.any(String),
    });
  });

  it('permite que o dono assista sem substituir o peer do estúdio', async () => {
    const service = createService();
    const stream = await service.create(host, 'Live', 'guild-1', 'MEMBERS');
    const current = service.join(stream.id, host, 'studio-tab');
    service.attach(stream.id, current.peerId);

    const viewer = service.join(stream.id, host, 'watch-tab', true);

    expect(viewer.role).toBe('viewer');
    expect(viewer.hostPeerId).toBe(current.peerId);
    expect(service.createTicket(stream.id, current.peerId, host)).toEqual({
      ticket: expect.any(String),
    });
  });

  it('mantém a live por 90 segundos quando o host fecha ou atualiza a aba', async () => {
    const service = createService();
    const stream = await service.create(host, 'Live', 'guild-1', 'MEMBERS');
    const current = service.join(stream.id, host, 'studio-tab');
    service.attach(stream.id, current.peerId);
    await service.start(stream.id, host);

    await expect(
      service.leave(stream.id, current.peerId, host),
    ).resolves.toEqual({
      left: true,
      ended: false,
    });
    expect(service.findOne(stream.id)).toEqual(
      expect.objectContaining({ id: stream.id, live: true }),
    );
    expect(service.join(stream.id, host, 'reopened-tab').role).toBe('host');
  });

  it('restaura uma transmissão ativa depois que a API reinicia', async () => {
    const startedAt = new Date('2026-08-20T23:00:00.000Z');
    const service = createService([
      {
        id: 'persisted-live',
        slug: 'host',
        title: 'Live persistida',
        hostUserId: host.id,
        hostName: host.name,
        hostAvatar: null,
        hostDiscordId: host.discordId,
        guildId: 'guild-1',
        visibility: 'PUBLIC',
        startedAt,
        broadcasting: true,
        announced: true,
      },
    ]);

    await service.onModuleInit();

    expect(service.list()).toEqual([
      expect.objectContaining({
        id: 'persisted-live',
        slug: 'host',
        live: true,
        startedAt: startedAt.toISOString(),
      }),
    ]);
    expect(service.join('host', host, 'studio').role).toBe('host');
  });

  it('gera um link curto com o nick normalizado', async () => {
    const service = createService();
    const stream = await service.create(
      { ...host, name: 'João.Player' },
      'Live',
      'guild-1',
      'PUBLIC',
    );

    expect(stream.slug).toBe('joao.player');
    expect(service.findOne('joao.player')).toEqual(
      expect.objectContaining({ id: stream.id, slug: 'joao.player' }),
    );
  });
});
