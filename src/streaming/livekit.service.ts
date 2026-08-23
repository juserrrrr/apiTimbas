import { Injectable, Logger } from '@nestjs/common';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { FEATURE_LIVE_SFU } from '../feature-flags/feature-flags.constants';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { SettingsService, type EncryptionStatus } from '../settings/settings.service';

const TOKEN_TTL = '4h';
const SETTINGS_CACHE_MS = 15_000;

const SETTING_URL = 'livekit.url';
const SETTING_API_KEY = 'livekit.apiKey';
const SETTING_API_SECRET = 'livekit.apiSecret';

export interface RtcGrant {
  role: 'host' | 'viewer';
  peerId: string;
  name: string;
}

export interface RtcCredentials {
  url: string;
  token: string;
  room: string;
}

export interface SfuSettings {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export interface SfuStatus {
  url: string;
  apiKey: string;
  /** The secret itself is never returned, only whether one is stored. */
  hasSecret: boolean;
  configured: boolean;
  enabled: boolean;
  featureEnabled: boolean;
  /** Where the credentials came from, so the panel can explain overrides. */
  source: 'database' | 'environment' | 'none';
  /** How the stored secret is protected at rest. */
  encryption: EncryptionStatus;
}

/**
 * Mints the short lived tokens browsers use to reach the self hosted LiveKit
 * SFU, and owns where its credentials come from.
 *
 * The panel writes them to the database so turning the SFU on does not need a
 * redeploy. Environment variables still work and act as the fallback, which is
 * what keeps an existing deploy running after this was introduced.
 *
 * With the feature flag off, or with no credentials anywhere, every caller is
 * told the SFU is unavailable and the live falls back to peer to peer.
 */
@Injectable()
export class LivekitService {
  private readonly logger = new Logger(LivekitService.name);
  private roomServices = new Map<string, RoomServiceClient>();
  private cache: { settings: SfuSettings; source: SfuStatus['source']; at: number } | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  private envSettings(): SfuSettings {
    return {
      url: process.env.LIVEKIT_URL?.trim() ?? '',
      apiKey: process.env.LIVEKIT_API_KEY?.trim() ?? '',
      apiSecret: process.env.LIVEKIT_API_SECRET?.trim() ?? '',
    };
  }

  private static isComplete(settings: SfuSettings) {
    return Boolean(settings.url && settings.apiKey && settings.apiSecret);
  }

  private async load(): Promise<{ settings: SfuSettings; source: SfuStatus['source'] }> {
    if (this.cache && Date.now() - this.cache.at < SETTINGS_CACHE_MS) {
      return { settings: this.cache.settings, source: this.cache.source };
    }

    let stored: SfuSettings = { url: '', apiKey: '', apiSecret: '' };
    try {
      const byKey = await this.settings.getMany([
        SETTING_URL,
        SETTING_API_KEY,
        SETTING_API_SECRET,
      ]);
      stored = {
        url: byKey.get(SETTING_URL)?.trim() ?? '',
        apiKey: byKey.get(SETTING_API_KEY)?.trim() ?? '',
        apiSecret: byKey.get(SETTING_API_SECRET)?.trim() ?? '',
      };
    } catch (error) {
      this.logger.warn(
        `Could not read SFU settings: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    const env = this.envSettings();
    const useStored = LivekitService.isComplete(stored);
    const settings = useStored ? stored : env;
    const source: SfuStatus['source'] = useStored
      ? 'database'
      : LivekitService.isComplete(env)
        ? 'environment'
        : 'none';

    this.cache = { settings, source, at: Date.now() };
    return { settings, source };
  }

  /** Credentials exist. Says nothing about the feature flag. */
  async isConfigured() {
    const { settings } = await this.load();
    return LivekitService.isComplete(settings);
  }

  /** Credentials exist and the admin turned the SFU on. */
  async isEnabled() {
    const [configured, featureEnabled] = await Promise.all([
      this.isConfigured(),
      this.featureFlags.isEnabled(FEATURE_LIVE_SFU),
    ]);
    return configured && featureEnabled;
  }

  async status(): Promise<SfuStatus> {
    const [{ settings, source }, featureEnabled] = await Promise.all([
      this.load(),
      this.featureFlags.isEnabled(FEATURE_LIVE_SFU),
    ]);
    const configured = LivekitService.isComplete(settings);

    return {
      url: settings.url,
      apiKey: settings.apiKey,
      hasSecret: Boolean(settings.apiSecret),
      configured,
      featureEnabled,
      enabled: configured && featureEnabled,
      source,
      encryption: this.settings.encryptionStatus(),
    };
  }

  /**
   * An empty secret keeps whatever is stored, so the panel can edit the URL
   * without asking the admin to paste the secret again.
   */
  async save(input: { url: string; apiKey: string; apiSecret?: string }) {
    const entries: [string, string][] = [
      [SETTING_URL, input.url.trim()],
      [SETTING_API_KEY, input.apiKey.trim()],
    ];
    const secret = input.apiSecret?.trim();
    if (secret) entries.push([SETTING_API_SECRET, secret]);

    for (const [key, value] of entries) {
      await this.settings.set(key, value);
    }

    this.cache = null;
    this.roomServices.clear();
    return this.status();
  }

  async clear() {
    await this.settings.remove([SETTING_URL, SETTING_API_KEY, SETTING_API_SECRET]);
    this.cache = null;
    this.roomServices.clear();
    return this.status();
  }

  /** Round trip to the server, so the panel can prove the deploy is reachable. */
  async test(): Promise<{ ok: boolean; message: string }> {
    const service = await this.getRoomService();
    if (!service) {
      return { ok: false, message: 'Preencha a URL, a chave e o segredo antes de testar.' };
    }
    try {
      const rooms = await service.listRooms();
      return {
        ok: true,
        message: `Servidor respondeu. ${rooms.length} sala(s) ativa(s) no momento.`,
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? `O servidor não respondeu: ${error.message}`
            : 'O servidor não respondeu.',
      };
    }
  }

  async credentials(
    streamId: string,
    grant: RtcGrant,
  ): Promise<RtcCredentials | null> {
    if (!(await this.isEnabled())) return null;
    const { settings } = await this.load();

    const room = this.roomName(streamId);
    const token = new AccessToken(settings.apiKey, settings.apiSecret, {
      identity: grant.peerId,
      name: grant.name,
      ttl: TOKEN_TTL,
    });

    // Viewers cannot publish and the host does not subscribe to anyone, so a
    // leaked viewer token cannot put media on the room.
    token.addGrant({
      roomJoin: true,
      room,
      canPublish: grant.role === 'host',
      canSubscribe: grant.role === 'viewer',
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });

    return { url: settings.url, token: await token.toJwt(), room };
  }

  /**
   * Ending a live should drop everyone immediately instead of waiting for the
   * clients to notice. Failures are logged and swallowed: the room expires on
   * its own once the last participant leaves.
   */
  async closeRoom(streamId: string) {
    const service = await this.getRoomService();
    if (!service) return;
    try {
      await service.deleteRoom(this.roomName(streamId));
    } catch (error) {
      this.logger.warn(
        `Could not delete LiveKit room for stream ${streamId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private roomName(streamId: string) {
    return `live-${streamId}`;
  }

  private async getRoomService() {
    const { settings } = await this.load();
    if (!LivekitService.isComplete(settings)) return null;

    // The management API speaks HTTP even though browsers connect over
    // WebSocket, so the scheme is swapped here.
    const httpUrl = settings.url.replace(/^ws/, 'http');
    const cacheKey = `${httpUrl}|${settings.apiKey}`;
    const cached = this.roomServices.get(cacheKey);
    if (cached) return cached;

    const service = new RoomServiceClient(
      httpUrl,
      settings.apiKey,
      settings.apiSecret,
    );
    this.roomServices.set(cacheKey, service);
    return service;
  }
}
