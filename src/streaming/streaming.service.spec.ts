import { ConflictException } from '@nestjs/common';
import { Client } from 'discord.js';
import { AccessService } from '../access/access.service';
import { Role } from '../enums/role.enum';
import { PrismaService } from '../prisma/prisma.service';
import { RequestUser, StreamingService } from './streaming.service';

describe('StreamingService host sessions', () => {
  const host: RequestUser = {
    id: 1,
    name: 'Host',
    role: Role.PLAYER,
    avatar: null,
    discordId: 'host-discord',
  };

  const createService = () =>
    new StreamingService(
      {} as AccessService,
      {} as PrismaService,
      {} as Client,
    );

  it('mantém o host atual quando o estúdio é aberto em outra aba', () => {
    const service = createService();
    const stream = service.create(host, 'Live', 'guild-1', 'MEMBERS');
    const current = service.join(stream.id, host, 'first-tab');
    service.attach(stream.id, current.peerId);

    expect(() => service.join(stream.id, host, 'second-tab')).toThrow(
      ConflictException,
    );
    expect(service.createTicket(stream.id, current.peerId, host)).toEqual({
      ticket: expect.any(String),
    });
  });

  it('permite que o dono assista sem substituir o peer do estúdio', () => {
    const service = createService();
    const stream = service.create(host, 'Live', 'guild-1', 'MEMBERS');
    const current = service.join(stream.id, host, 'studio-tab');
    service.attach(stream.id, current.peerId);

    const viewer = service.join(stream.id, host, 'watch-tab', true);

    expect(viewer.role).toBe('viewer');
    expect(viewer.hostPeerId).toBe(current.peerId);
    expect(service.createTicket(stream.id, current.peerId, host)).toEqual({
      ticket: expect.any(String),
    });
  });
});
