import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { Client, EmbedBuilder } from 'discord.js';
import { Subject } from 'rxjs';
import { AccessService } from '../access/access.service';
import { Role } from '../enums/role.enum';
import { PrismaService } from '../prisma/prisma.service';
import { LivekitService, type RtcGrant } from './livekit.service';

export interface SignalEvent {
  type: string;
  from?: string;
  payload?: unknown;
}

interface Peer {
  id: string;
  clientId: string | null;
  userId: number | null;
  name: string;
  avatar: string | null;
  discordId: string | null;
  guestToken: string | null;
  subject: Subject<SignalEvent>;
  attached: boolean;
  listening: boolean;
  pendingEvents: SignalEvent[];
  lastSeen: number;
}

interface Stream {
  id: string;
  slug: string;
  title: string;
  hostUserId: number;
  hostName: string;
  hostAvatar: string | null;
  hostDiscordId: string | null;
  guildId: string;
  visibility: 'MEMBERS' | 'PUBLIC';
  startedAt: number;
  broadcasting: boolean;
  announced: boolean;
  hostPeerId: string | null;
  hostMissingSince: number | null;
  peers: Map<string, Peer>;
}

export interface RequestUser {
  id: number;
  name: string;
  role: string;
  avatar: string | null;
  discordId: string | null;
}

export const STREAM_PERMISSION = 'stream.broadcast';
export const STREAM_MANAGE_PERMISSION = 'stream.manage';

const TICKET_TTL_MS = 30_000;
const PEER_STALE_MS = 60_000;
const HOST_GRACE_MS = 90_000;

@Injectable()
export class StreamingService implements OnModuleInit {
  private readonly logger = new Logger(StreamingService.name);
  private readonly streams = new Map<string, Stream>();
  private readonly tickets = new Map<
    string,
    { streamId: string; peerId: string; expiresAt: number }
  >();

  constructor(
    private readonly access: AccessService,
    private readonly prisma: PrismaService,
    private readonly client: Client,
    private readonly livekit: LivekitService,
  ) {}

  async onModuleInit() {
    const persisted = await this.prisma.activeStream.findMany();
    const restoredAt = Date.now();

    for (const row of persisted) {
      const stream: Stream = {
        id: row.id,
        slug: row.slug,
        title: row.title,
        hostUserId: row.hostUserId,
        hostName: row.hostName,
        hostAvatar: row.hostAvatar,
        hostDiscordId: row.hostDiscordId,
        guildId: row.guildId,
        visibility: row.visibility === 'PUBLIC' ? 'PUBLIC' : 'MEMBERS',
        startedAt: row.startedAt.getTime(),
        broadcasting: row.broadcasting,
        announced: row.announced,
        hostPeerId: null,
        hostMissingSince: restoredAt,
        peers: new Map(),
      };
      this.streams.set(stream.id, stream);
    }

    if (persisted.length) {
      this.logger.log(`Restored ${persisted.length} active live stream(s)`);
    }
  }

  // ─── PERMISSION ───────────────────────────────────────────────────────────

  async getPermission(userId: number) {
    return { canStream: await this.access.has(userId, [STREAM_PERMISSION]) };
  }

  // ─── STREAM LIFECYCLE ─────────────────────────────────────────────────────

  // Permission is enforced by PermissionGuard on the controller.
  async create(
    user: RequestUser,
    title: string | undefined,
    guildId: string,
    visibility: 'MEMBERS' | 'PUBLIC' = 'MEMBERS',
  ) {
    const existing = [...this.streams.values()].find(
      (s) => s.hostUserId === user.id,
    );
    if (existing) return this.toSummary(existing);

    const stream: Stream = {
      id: randomUUID(),
      slug: this.availableSlug(user.name, user.id),
      title: title?.trim() || `Transmissão de ${user.name}`,
      hostUserId: user.id,
      hostName: user.name,
      hostAvatar: user.avatar,
      hostDiscordId: user.discordId,
      guildId,
      visibility,
      startedAt: Date.now(),
      broadcasting: false,
      announced: false,
      hostPeerId: null,
      hostMissingSince: Date.now(),
      peers: new Map(),
    };
    await this.prisma.activeStream.create({
      data: {
        id: stream.id,
        slug: stream.slug,
        title: stream.title,
        hostUserId: stream.hostUserId,
        hostName: stream.hostName,
        hostAvatar: stream.hostAvatar,
        hostDiscordId: stream.hostDiscordId,
        guildId: stream.guildId,
        visibility: stream.visibility,
        startedAt: new Date(stream.startedAt),
      },
    });
    this.streams.set(stream.id, stream);
    this.logger.log(
      `Live created stream=${stream.id} visibility=${stream.visibility}`,
    );
    return this.toSummary(stream);
  }

  list(user?: RequestUser) {
    return [...this.streams.values()]
      .filter((stream) => stream.broadcasting)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((stream) => ({
        ...this.toSummary(stream),
        // Sem isso a lista mandaria o dono para a página de espectador da
        // própria live, sem caminho de volta para o estúdio.
        isHost: user ? stream.hostUserId === user.id : false,
      }));
  }

  findOne(id: string) {
    return this.toSummary(this.getStream(id));
  }

  viewers(id: string, user: RequestUser) {
    const stream = this.getStream(id);
    if (stream.hostUserId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Apenas o dono da transmissão pode consultar os espectadores.',
      );
    }
    return this.viewerList(stream);
  }

  async end(id: string, user: RequestUser) {
    const stream = this.getStream(id);
    if (stream.hostUserId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Apenas o dono da transmissão pode encerrá-la.',
      );
    }
    await this.destroy(stream, 'manual_end');
    return { ended: true };
  }

  async updateVisibility(
    id: string,
    user: RequestUser,
    visibility: 'MEMBERS' | 'PUBLIC',
  ) {
    const stream = this.getStream(id);
    if (stream.hostUserId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Only the stream owner can change its privacy.',
      );
    }

    if (stream.visibility === visibility) return this.toSummary(stream);
    stream.visibility = visibility;
    await this.prisma.activeStream.update({
      where: { id: stream.id },
      data: { visibility },
    });

    // Guests do not have an authenticated Timbas session. Remove them as soon
    // as the host makes the stream private.
    if (visibility === 'MEMBERS') {
      for (const peer of [...stream.peers.values()]) {
        if (peer.guestToken) {
          this.deliver(peer, { type: 'stream_ended' });
          this.dropPeer(stream, peer.id);
        }
      }
    }

    return this.toSummary(stream);
  }

  async start(id: string, user: RequestUser) {
    const stream = this.getStream(id);
    if (stream.hostUserId !== user.id) {
      throw new ForbiddenException(
        'Apenas o dono da transmissão pode iniciá-la.',
      );
    }

    if (!stream.broadcasting) {
      stream.broadcasting = true;
      stream.startedAt = Date.now();
      await this.prisma.activeStream.update({
        where: { id: stream.id },
        data: { broadcasting: true, startedAt: new Date(stream.startedAt) },
      });
      this.logger.log(`Live started stream=${stream.id}`);
      await this.announceToDiscord(stream).catch(() => {});
      if (stream.announced) {
        await this.prisma.activeStream.update({
          where: { id: stream.id },
          data: { announced: true },
        });
      }
    }

    return this.toSummary(stream);
  }

  async announcementGuilds() {
    const settings = await this.prisma.streamAnnouncementChannel.findMany();
    const configured = new Map(
      settings.map((setting) => [setting.guildId, setting.channelId]),
    );

    return [...this.client.guilds.cache.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map((guild) => ({
        id: guild.id,
        name: guild.name,
        channelId: configured.get(guild.id) ?? null,
        channels: [...guild.channels.cache.values()]
          .filter((channel) => channel.isTextBased() && !channel.isDMBased())
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
          .map((channel) => ({ id: channel.id, name: channel.name })),
      }));
  }

  async announcementTargets() {
    const guilds = await this.announcementGuilds();
    return guilds.map(({ id, name, channelId }) => ({
      id,
      name,
      configured: channelId !== null,
    }));
  }

  async setAnnouncementChannel(guildId: string, channelId?: string) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild)
      throw new NotFoundException(
        'Servidor do Discord não encontrado pelo bot.',
      );

    if (!channelId) {
      await this.prisma.streamAnnouncementChannel
        .delete({ where: { guildId } })
        .catch(() => undefined);
      return { guildId, channelId: null };
    }

    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      throw new NotFoundException(
        'Canal de texto não encontrado neste servidor.',
      );
    }

    await this.prisma.streamAnnouncementChannel.upsert({
      where: { guildId },
      create: { guildId, channelId },
      update: { channelId },
    });
    return { guildId, channelId };
  }

  // ─── JOIN / LEAVE ─────────────────────────────────────────────────────────

  join(id: string, user: RequestUser, clientId?: string, asViewer = false) {
    const stream = this.getStream(id);
    const isHost = stream.hostUserId === user.id && !asViewer;
    const peerId = randomUUID();

    const peer: Peer = {
      id: peerId,
      clientId: clientId ?? null,
      userId: user.id,
      name: user.name,
      avatar: user.avatar,
      discordId: user.discordId,
      guestToken: null,
      subject: new Subject<SignalEvent>(),
      attached: false,
      listening: false,
      pendingEvents: [],
      lastSeen: Date.now(),
    };

    if (isHost) {
      // Host reconnecting: drop the old signaling peer but keep the viewers, so
      // the new host peer can renegotiate with each one of them.
      const previous = stream.hostPeerId
        ? stream.peers.get(stream.hostPeerId)
        : null;
      if (previous?.attached) {
        throw new ConflictException(
          'A transmissão já está aberta em outra aba. Feche a outra aba antes de abrir o estúdio aqui.',
        );
      }
      if (previous) {
        stream.peers.delete(previous.id);
        previous.subject.complete();
      }
      stream.hostPeerId = peerId;
      stream.hostMissingSince = null;
      stream.peers.set(peerId, peer);
      this.logger.log(
        `Live peer joined stream=${stream.id} peer=${peerId} role=host`,
      );
      this.broadcastToViewers(stream, { type: 'host_ready', from: peerId });
    } else {
      // A refresh creates a new browser peer before the old page can finish
      // its leave request. Keep one viewer per user/browser tab.
      for (const existing of [...stream.peers.values()]) {
        if (
          existing.id !== stream.hostPeerId &&
          (existing.userId === user.id ||
            (clientId && existing.clientId === clientId))
        ) {
          this.dropPeer(stream, existing.id);
        }
      }
      stream.peers.set(peerId, peer);
      this.logger.log(
        `Live peer joined stream=${stream.id} peer=${peerId} role=viewer`,
      );
    }

    return {
      peerId,
      role: isHost ? 'host' : 'viewer',
      hostPeerId: stream.hostPeerId,
      viewers: isHost ? this.viewerList(stream) : [],
      stream: this.toSummary(stream),
      // Verdadeiro mesmo quando a pessoa entrou como espectador, para a tela de
      // quem assiste conseguir oferecer a volta ao estúdio.
      owner: stream.hostUserId === user.id,
    };
  }

  joinPublic(id: string, clientId?: string) {
    const stream = this.getStream(id);
    this.assertPublic(stream);

    if (clientId) {
      for (const existing of [...stream.peers.values()]) {
        if (existing.id !== stream.hostPeerId && existing.clientId === clientId)
          this.dropPeer(stream, existing.id);
      }
    }

    const peerId = randomUUID();
    const guestToken = randomUUID();
    const peer: Peer = {
      id: peerId,
      clientId: clientId ?? null,
      userId: null,
      name: 'Convidado',
      avatar: null,
      discordId: null,
      guestToken,
      subject: new Subject<SignalEvent>(),
      attached: false,
      listening: false,
      pendingEvents: [],
      lastSeen: Date.now(),
    };
    stream.peers.set(peerId, peer);
    this.logger.log(
      `Live peer joined stream=${stream.id} peer=${peerId} role=guest`,
    );
    return {
      peerId,
      guestToken,
      hostPeerId: stream.hostPeerId,
      stream: this.toSummary(stream),
    };
  }

  async leave(id: string, peerId: string, user: RequestUser) {
    const stream = this.findStream(id);
    if (!stream) return { left: true };

    const peer = stream.peers.get(peerId);
    if (peer && peer.userId !== user.id) {
      throw new ForbiddenException('Peer não pertence a este usuário.');
    }

    if (stream.hostPeerId === peerId) {
      stream.peers.delete(peerId);
      peer?.subject.complete();
      stream.hostPeerId = null;
      stream.hostMissingSince = Date.now();
      this.broadcastToViewers(stream, { type: 'host_unavailable' });
      this.logger.log(
        `Live host temporarily disconnected stream=${stream.id} grace=${HOST_GRACE_MS}ms`,
      );
      return { left: true, ended: false };
    }

    this.dropPeer(stream, peerId);
    return { left: true };
  }

  leavePublic(id: string, peerId: string, guestToken: string) {
    const stream = this.findStream(id);
    if (!stream) return { left: true };
    const peer = this.guestPeer(stream, peerId, guestToken);
    this.dropPeer(stream, peer.id);
    return { left: true };
  }

  // ─── SIGNALING ────────────────────────────────────────────────────────────

  createTicket(streamId: string, peerId: string, user: RequestUser) {
    const stream = this.getStream(streamId);
    const peer = stream.peers.get(peerId);
    if (!peer)
      throw new NotFoundException(
        'Peer não encontrado. Entre na transmissão novamente.',
      );
    if (peer.userId !== user.id)
      throw new ForbiddenException('Peer não pertence a este usuário.');

    const ticket = randomUUID();
    this.tickets.set(ticket, {
      streamId,
      peerId,
      expiresAt: Date.now() + TICKET_TTL_MS,
    });
    return { ticket };
  }

  createPublicTicket(streamId: string, peerId: string, guestToken: string) {
    const stream = this.getStream(streamId);
    this.assertPublic(stream);
    this.guestPeer(stream, peerId, guestToken);
    const ticket = randomUUID();
    this.tickets.set(ticket, {
      streamId,
      peerId,
      expiresAt: Date.now() + TICKET_TTL_MS,
    });
    return { ticket };
  }

  consumeTicket(ticket: string, streamId: string): string | null {
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) return null;
    if (entry.streamId !== streamId) return null;
    return entry.peerId;
  }

  attach(streamId: string, peerId: string) {
    const stream = this.getStream(streamId);
    const peer = stream.peers.get(peerId);
    if (!peer) throw new NotFoundException('Peer não encontrado.');

    peer.attached = true;
    peer.listening = false;
    peer.lastSeen = Date.now();
    this.logger.log(
      `Live events attached stream=${stream.id} peer=${peer.id} role=${peer.id === stream.hostPeerId ? 'host' : 'viewer'}`,
    );
    return peer.subject;
  }

  activate(streamId: string, peerId: string) {
    const stream = this.findStream(streamId);
    const peer = stream?.peers.get(peerId);
    if (!peer) return;

    const pending = peer.pendingEvents.splice(0);
    for (const event of pending) peer.subject.next(event);
    peer.listening = true;
  }

  // Called once the SSE response is subscribed, otherwise these events would be
  // emitted into a subject nobody is listening to yet.
  announce(streamId: string, peerId: string) {
    const stream = this.findStream(streamId);
    const peer = stream?.peers.get(peerId);
    if (!stream || !peer) return;

    if (peerId === stream.hostPeerId) {
      // Viewers that arrived before this channel opened would be invisible to
      // the host, so replay them now.
      for (const viewer of stream.peers.values()) {
        if (viewer.id !== peerId && viewer.attached)
          this.sendToHost(stream, this.viewerJoinedEvent(viewer));
      }
      return;
    }

    this.sendToHost(stream, this.viewerJoinedEvent(peer));
    this.broadcastViewerCount(stream);
  }

  detach(streamId: string, peerId: string) {
    const stream = this.findStream(streamId);
    const peer = stream?.peers.get(peerId);
    if (!peer) return;

    const wasAttached = peer.attached;
    peer.attached = false;
    peer.listening = false;
    peer.lastSeen = Date.now();

    if (peerId === stream.hostPeerId) {
      stream.hostMissingSince = peer.lastSeen;
      this.broadcastToViewers(stream, { type: 'host_unavailable' });
      return;
    }

    // The SSE connection is the viewer's live presence. This runs when a tab
    // refreshes or closes, so the count never accumulates stale viewers.
    if (wasAttached) {
      this.sendToHost(stream, { type: 'viewer_left', from: peerId });
      this.broadcastViewerCount(stream);
    }
  }

  // ─── SFU ──────────────────────────────────────────────────────────────────

  // Who a peer is inside the room is decided here, never by the browser: the
  // host peer is the only identity allowed to publish media.
  rtcGrant(streamId: string, peerId: string, user: RequestUser): RtcGrant {
    const stream = this.getStream(streamId);
    const peer = stream.peers.get(peerId);
    if (!peer) throw new NotFoundException('Peer não encontrado na transmissão.');
    if (peer.userId !== user.id)
      throw new ForbiddenException('Peer não pertence a este usuário.');

    peer.lastSeen = Date.now();
    return {
      role: peerId === stream.hostPeerId ? 'host' : 'viewer',
      peerId,
      name: peer.name,
    };
  }

  publicRtcGrant(
    streamId: string,
    peerId: string,
    guestToken: string,
  ): RtcGrant {
    const stream = this.getStream(streamId);
    this.assertPublic(stream);
    const peer = this.guestPeer(stream, peerId, guestToken);
    peer.lastSeen = Date.now();
    return { role: 'viewer', peerId, name: peer.name };
  }

  // ─── CLEANUP ──────────────────────────────────────────────────────────────

  @Interval(5_000)
  async cleanup() {
    const now = Date.now();

    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt < now) this.tickets.delete(ticket);
    }

    for (const stream of [...this.streams.values()]) {
      // Created but never opened a signaling channel: the host gave up.
      if (
        !stream.hostPeerId &&
        stream.hostMissingSince !== null &&
        now - stream.hostMissingSince > HOST_GRACE_MS
      ) {
        await this.destroy(stream, 'host_never_connected');
        continue;
      }

      for (const peer of [...stream.peers.values()]) {
        if (peer.attached) continue;
        const grace =
          peer.id === stream.hostPeerId ? HOST_GRACE_MS : PEER_STALE_MS;
        if (now - peer.lastSeen < grace) continue;

        if (peer.id === stream.hostPeerId) {
          await this.destroy(stream, 'host_events_timeout');
          break;
        }
        this.dropPeer(stream, peer.id);
      }
    }
  }

  // ─── INTERNALS ────────────────────────────────────────────────────────────

  private getStream(identifier: string): Stream {
    const stream = this.findStream(identifier);
    if (!stream)
      throw new NotFoundException(
        'Transmissão não encontrada ou já encerrada.',
      );
    return stream;
  }

  private findStream(identifier: string): Stream | undefined {
    return (
      this.streams.get(identifier) ??
      [...this.streams.values()].find(
        (stream) => stream.slug === identifier.toLocaleLowerCase('en-US'),
      )
    );
  }

  private availableSlug(name: string, userId: number): string {
    const base =
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'live';
    const inUse = (candidate: string) =>
      [...this.streams.values()].some(
        (stream) => stream.hostUserId !== userId && stream.slug === candidate,
      );

    if (!inUse(base)) return base;
    let candidate = `${base}-${userId}`;
    while (inUse(candidate)) candidate = `${candidate}-live`;
    return candidate;
  }

  private assertPublic(stream: Stream) {
    if (!stream.broadcasting) {
      throw new NotFoundException(
        'Transmissão não encontrada ou já encerrada.',
      );
    }
    if (stream.visibility !== 'PUBLIC') {
      throw new NotFoundException(
        'Esta transmissão é privada. Entre no Timbas para assistir.',
      );
    }
  }

  private guestPeer(stream: Stream, peerId: string, guestToken: string) {
    const peer = stream.peers.get(peerId);
    if (!peer || !peer.guestToken || peer.guestToken !== guestToken) {
      throw new ForbiddenException('Sessão de convidado inválida.');
    }
    return peer;
  }

  private toSummary(stream: Stream) {
    return {
      id: stream.id,
      slug: stream.slug,
      title: stream.title,
      hostName: stream.hostName,
      hostAvatar: stream.hostAvatar,
      hostDiscordId: stream.hostDiscordId,
      visibility: stream.visibility,
      startedAt: new Date(stream.startedAt).toISOString(),
      viewers: this.viewerList(stream).length,
      live: stream.broadcasting,
    };
  }

  private viewerJoinedEvent(peer: Peer): SignalEvent {
    return {
      type: 'viewer_joined',
      from: peer.id,
      payload: { name: peer.name },
    };
  }

  private viewerList(stream: Stream) {
    return [...stream.peers.values()]
      .filter((peer) => peer.id !== stream.hostPeerId && peer.attached)
      .map((peer) => ({
        peerId: peer.id,
        name: peer.name,
      }));
  }

  private dropPeer(stream: Stream, peerId: string) {
    const peer = stream.peers.get(peerId);
    if (!peer) return;

    stream.peers.delete(peerId);
    peer.subject.complete();

    if (peerId !== stream.hostPeerId) {
      this.sendToHost(stream, { type: 'viewer_left', from: peerId });
      this.broadcastViewerCount(stream);
    }
  }

  private async destroy(
    stream: Stream,
    reason:
      | 'manual_end'
      | 'host_leave'
      | 'host_never_connected'
      | 'host_events_timeout',
  ) {
    this.logger.warn(
      `Live destroyed stream=${stream.id} reason=${reason} viewers=${this.viewerList(stream).length}`,
    );
    const hostPeerId = stream.hostPeerId;
    for (const peer of stream.peers.values()) {
      if (peer.id !== hostPeerId) this.deliver(peer, { type: 'stream_ended' });
      peer.subject.complete();
    }
    stream.peers.clear();
    stream.hostPeerId = null;
    this.streams.delete(stream.id);
    await this.prisma.activeStream.deleteMany({ where: { id: stream.id } });
    await this.livekit.closeRoom(stream.id);
  }

  private async announceToDiscord(stream: Stream) {
    if (stream.announced) return;
    const setting = await this.prisma.streamAnnouncementChannel.findUnique({
      where: { guildId: stream.guildId },
    });
    if (!setting) return;

    const guild = this.client.guilds.cache.get(stream.guildId);
    const channel = guild?.channels.cache.get(setting.channelId);
    if (!channel?.isTextBased() || channel.isDMBased()) return;

    const webUrl = process.env.WEB_URL?.replace(/\/+$/, '');
    const watchPath = `/live/${stream.slug}`;
    const watchUrl = webUrl ? `${webUrl}${watchPath}` : null;
    const host = stream.hostDiscordId
      ? `<@${stream.hostDiscordId}>`
      : stream.hostName;
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('🔴 Transmissão ao vivo')
      .setDescription(`${host} começou uma transmissão.`)
      .addFields({ name: 'Ao vivo agora', value: stream.title })
      .setTimestamp();

    if (watchUrl) embed.setURL(watchUrl);
    if (stream.hostDiscordId && stream.hostAvatar) {
      embed.setAuthor({
        name: stream.hostName,
        iconURL: `https://cdn.discordapp.com/avatars/${stream.hostDiscordId}/${stream.hostAvatar}.png?size=64`,
      });
    }

    await channel.send({
      content: stream.hostDiscordId ? `<@${stream.hostDiscordId}>` : undefined,
      embeds: [embed],
    });
    stream.announced = true;
  }

  private deliver(peer: Peer, event: SignalEvent) {
    if (peer.listening) {
      peer.subject.next(event);
      return;
    }

    if (peer.pendingEvents.length >= 128) peer.pendingEvents.shift();
    peer.pendingEvents.push(event);
  }

  private sendToHost(stream: Stream, event: SignalEvent) {
    if (!stream.hostPeerId) return;
    const host = stream.peers.get(stream.hostPeerId);
    if (host) this.deliver(host, event);
  }

  private broadcastToViewers(stream: Stream, event: SignalEvent) {
    for (const peer of stream.peers.values()) {
      if (peer.id !== stream.hostPeerId) this.deliver(peer, event);
    }
  }

  private broadcastViewerCount(stream: Stream) {
    const count = this.viewerList(stream).length;
    for (const peer of stream.peers.values()) {
      this.deliver(peer, { type: 'viewers', payload: { count } });
    }
  }
}
