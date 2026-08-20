import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { Subject } from 'rxjs';
import { AccessService } from '../access/access.service';
import { Role } from '../enums/role.enum';
import { SignalDto } from './dto/signal.dto';

export interface SignalEvent {
  type: string;
  from?: string;
  payload?: unknown;
}

interface Peer {
  id: string;
  userId: number;
  name: string;
  avatar: string | null;
  discordId: string | null;
  subject: Subject<SignalEvent>;
  attached: boolean;
  lastSeen: number;
}

interface Stream {
  id: string;
  title: string;
  hostUserId: number;
  hostName: string;
  hostAvatar: string | null;
  hostDiscordId: string | null;
  startedAt: number;
  hostPeerId: string | null;
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

const TICKET_TTL_MS = 30_000;
const PEER_STALE_MS = 60_000;
const HOST_GRACE_MS = 90_000;

@Injectable()
export class StreamingService {
  private readonly streams = new Map<string, Stream>();
  private readonly tickets = new Map<string, { streamId: string; peerId: string; expiresAt: number }>();

  constructor(private readonly access: AccessService) {}

  // ─── PERMISSION ───────────────────────────────────────────────────────────

  async getPermission(userId: number) {
    return { canStream: await this.access.has(userId, [STREAM_PERMISSION]) };
  }

  // ─── ICE ──────────────────────────────────────────────────────────────────

  // TURN credentials stay server side; the browser fetches them per session.
  iceServers() {
    const servers: { urls: string | string[]; username?: string; credential?: string }[] = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ];

    const turnUrls = process.env.TURN_URLS;
    if (turnUrls) {
      servers.push({
        urls: turnUrls.split(',').map((url) => url.trim()),
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL,
      });
    }
    return servers;
  }

  // ─── STREAM LIFECYCLE ─────────────────────────────────────────────────────

  // Permission is enforced by PermissionGuard on the controller.
  create(user: RequestUser, title?: string) {
    const existing = [...this.streams.values()].find((s) => s.hostUserId === user.id);
    if (existing) return this.toSummary(existing);

    const stream: Stream = {
      id: randomUUID(),
      title: title?.trim() || `Transmissão de ${user.name}`,
      hostUserId: user.id,
      hostName: user.name,
      hostAvatar: user.avatar,
      hostDiscordId: user.discordId,
      startedAt: Date.now(),
      hostPeerId: null,
      peers: new Map(),
    };
    this.streams.set(stream.id, stream);
    return this.toSummary(stream);
  }

  list() {
    return [...this.streams.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((stream) => this.toSummary(stream));
  }

  findOne(id: string) {
    return this.toSummary(this.getStream(id));
  }

  end(id: string, user: RequestUser) {
    const stream = this.getStream(id);
    if (stream.hostUserId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('Apenas o dono da transmissão pode encerrá-la.');
    }
    this.destroy(stream);
    return { ended: true };
  }

  // ─── JOIN / LEAVE ─────────────────────────────────────────────────────────

  join(id: string, user: RequestUser) {
    const stream = this.getStream(id);
    const isHost = stream.hostUserId === user.id;
    const peerId = randomUUID();

    const peer: Peer = {
      id: peerId,
      userId: user.id,
      name: user.name,
      avatar: user.avatar,
      discordId: user.discordId,
      subject: new Subject<SignalEvent>(),
      attached: false,
      lastSeen: Date.now(),
    };

    if (isHost) {
      // Host reconnecting: drop the old signaling peer but keep the viewers, so
      // the new host peer can renegotiate with each one of them.
      const previous = stream.hostPeerId ? stream.peers.get(stream.hostPeerId) : null;
      if (previous) {
        stream.peers.delete(previous.id);
        previous.subject.complete();
      }
      stream.hostPeerId = peerId;
      stream.peers.set(peerId, peer);
      this.broadcastToViewers(stream, { type: 'host_ready', from: peerId });
    } else {
      stream.peers.set(peerId, peer);
    }

    return {
      peerId,
      role: isHost ? 'host' : 'viewer',
      hostPeerId: stream.hostPeerId,
      viewers: isHost ? this.viewerList(stream) : [],
      stream: this.toSummary(stream),
    };
  }

  leave(id: string, peerId: string, user: RequestUser) {
    const stream = this.streams.get(id);
    if (!stream) return { left: true };

    const peer = stream.peers.get(peerId);
    if (peer && peer.userId !== user.id) {
      throw new ForbiddenException('Peer não pertence a este usuário.');
    }

    if (stream.hostPeerId === peerId) {
      this.destroy(stream);
      return { left: true, ended: true };
    }

    this.dropPeer(stream, peerId);
    return { left: true };
  }

  // ─── SIGNALING ────────────────────────────────────────────────────────────

  createTicket(streamId: string, peerId: string, user: RequestUser) {
    const stream = this.getStream(streamId);
    const peer = stream.peers.get(peerId);
    if (!peer) throw new NotFoundException('Peer não encontrado. Entre na transmissão novamente.');
    if (peer.userId !== user.id) throw new ForbiddenException('Peer não pertence a este usuário.');

    const ticket = randomUUID();
    this.tickets.set(ticket, { streamId, peerId, expiresAt: Date.now() + TICKET_TTL_MS });
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
    peer.lastSeen = Date.now();
    return peer.subject;
  }

  // Called once the SSE response is subscribed, otherwise these events would be
  // emitted into a subject nobody is listening to yet.
  announce(streamId: string, peerId: string) {
    const stream = this.streams.get(streamId);
    const peer = stream?.peers.get(peerId);
    if (!stream || !peer) return;

    if (peerId === stream.hostPeerId) {
      // Viewers that arrived before this channel opened would be invisible to
      // the host, so replay them now.
      for (const viewer of stream.peers.values()) {
        if (viewer.id !== peerId) peer.subject.next(this.viewerJoinedEvent(viewer));
      }
      return;
    }

    this.sendToHost(stream, this.viewerJoinedEvent(peer));
    this.broadcastViewerCount(stream);
  }

  detach(streamId: string, peerId: string) {
    const stream = this.streams.get(streamId);
    const peer = stream?.peers.get(peerId);
    if (!peer) return;

    peer.attached = false;
    peer.lastSeen = Date.now();
  }

  signal(streamId: string, dto: SignalDto, user: RequestUser) {
    const stream = this.getStream(streamId);
    const from = stream.peers.get(dto.from);
    if (!from) throw new NotFoundException('Peer de origem não encontrado.');
    if (from.userId !== user.id) throw new ForbiddenException('Peer não pertence a este usuário.');

    const target = stream.peers.get(dto.to);
    if (!target) throw new NotFoundException('Destinatário não está mais na transmissão.');

    // Viewers only talk to the host; the host talks to anyone in the room.
    if (dto.from !== stream.hostPeerId && dto.to !== stream.hostPeerId) {
      throw new ForbiddenException('Viewers só podem sinalizar para o host.');
    }

    from.lastSeen = Date.now();
    target.subject.next({ type: dto.type, from: dto.from, payload: dto.data });
    return { sent: true };
  }

  // ─── CLEANUP ──────────────────────────────────────────────────────────────

  @Interval(30_000)
  cleanup() {
    const now = Date.now();

    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt < now) this.tickets.delete(ticket);
    }

    for (const stream of [...this.streams.values()]) {
      // Created but never opened a signaling channel: the host gave up.
      if (!stream.hostPeerId && now - stream.startedAt > HOST_GRACE_MS) {
        this.destroy(stream);
        continue;
      }

      for (const peer of [...stream.peers.values()]) {
        if (peer.attached) continue;
        const grace = peer.id === stream.hostPeerId ? HOST_GRACE_MS : PEER_STALE_MS;
        if (now - peer.lastSeen < grace) continue;

        if (peer.id === stream.hostPeerId) this.destroy(stream);
        else this.dropPeer(stream, peer.id);
      }
    }
  }

  // ─── INTERNALS ────────────────────────────────────────────────────────────

  private getStream(id: string): Stream {
    const stream = this.streams.get(id);
    if (!stream) throw new NotFoundException('Transmissão não encontrada ou já encerrada.');
    return stream;
  }

  private toSummary(stream: Stream) {
    return {
      id: stream.id,
      title: stream.title,
      hostUserId: stream.hostUserId,
      hostName: stream.hostName,
      hostAvatar: stream.hostAvatar,
      hostDiscordId: stream.hostDiscordId,
      startedAt: new Date(stream.startedAt).toISOString(),
      viewers: this.viewerList(stream).length,
      live: stream.hostPeerId !== null,
    };
  }

  private viewerJoinedEvent(peer: Peer): SignalEvent {
    return {
      type: 'viewer_joined',
      from: peer.id,
      payload: { name: peer.name, avatar: peer.avatar, discordId: peer.discordId },
    };
  }

  private viewerList(stream: Stream) {
    return [...stream.peers.values()]
      .filter((peer) => peer.id !== stream.hostPeerId)
      .map((peer) => ({
        peerId: peer.id,
        name: peer.name,
        avatar: peer.avatar,
        discordId: peer.discordId,
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

  private destroy(stream: Stream) {
    const hostPeerId = stream.hostPeerId;
    for (const peer of stream.peers.values()) {
      if (peer.id !== hostPeerId) peer.subject.next({ type: 'stream_ended' });
      peer.subject.complete();
    }
    stream.peers.clear();
    stream.hostPeerId = null;
    this.streams.delete(stream.id);
  }

  private sendToHost(stream: Stream, event: SignalEvent) {
    if (!stream.hostPeerId) return;
    stream.peers.get(stream.hostPeerId)?.subject.next(event);
  }

  private broadcastToViewers(stream: Stream, event: SignalEvent) {
    for (const peer of stream.peers.values()) {
      if (peer.id !== stream.hostPeerId) peer.subject.next(event);
    }
  }

  private broadcastViewerCount(stream: Stream) {
    const count = this.viewerList(stream).length;
    for (const peer of stream.peers.values()) {
      peer.subject.next({ type: 'viewers', payload: { count } });
    }
  }
}
