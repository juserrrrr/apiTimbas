import { Injectable, Logger } from '@nestjs/common';

const CLOUDFLARE_TURN_TTL_SECONDS = 3_600;
const CLOUDFLARE_TURN_CACHE_MS = 5 * 60_000;

const STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Resolve os servidores ICE que o navegador usa para achar caminho até o outro
 * lado.
 *
 * STUN só descobre o próprio endereço público, e isso não basta para quem está
 * atrás de NAT simétrico, o caso da maioria das conexões móveis e de boa parte
 * dos provedores que usam CGNAT. Sem um TURN para retransmitir, essas pessoas
 * não conectam nunca: ficam tentando até desistirem. É por isso que o relay é
 * requisito, e não enfeite, no modo ponto a ponto.
 *
 * O caminho padrão é o Coturn do próprio VPS (docker-compose.turn.yml), via
 * TURN_URLS. O TURN gerenciado da Cloudflare fica como alternativa para quem
 * não quiser manter o container.
 */
@Injectable()
export class TurnService {
  private readonly logger = new Logger(TurnService.name);
  private cloudflareCache: { servers: IceServer[]; expiresAt: number } | null = null;

  hasRelay() {
    return Boolean(
      process.env.TURN_URLS?.trim() ||
        (process.env.CLOUDFLARE_TURN_KEY_ID?.trim() &&
          process.env.CLOUDFLARE_TURN_API_TOKEN?.trim()),
    );
  }

  // Segredo de TURN fica no servidor. O navegador só recebe as credenciais
  // configuradas do Coturn ou as de curta duração da Cloudflare.
  async iceServers(): Promise<IceServer[]> {
    const servers: IceServer[] = [{ urls: [...STUN_SERVERS] }];

    const urls = process.env.TURN_URLS?.trim();
    if (urls) {
      servers.push({
        urls: urls.split(',').map((url) => url.trim()).filter(Boolean),
        username: process.env.TURN_USERNAME?.trim() || undefined,
        credential: process.env.TURN_CREDENTIAL?.trim() || undefined,
      });
      return servers;
    }

    const keyId = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
    const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
    if (!keyId || !apiToken) {
      this.logger.warn(
        'Nenhum TURN configurado: quem estiver em 4G ou atrás de CGNAT não vai conseguir assistir no modo ponto a ponto.',
      );
      return servers;
    }

    if (this.cloudflareCache && this.cloudflareCache.expiresAt > Date.now()) {
      return [...servers, ...this.cloudflareCache.servers];
    }

    try {
      const response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: CLOUDFLARE_TURN_TTL_SECONDS }),
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) throw new Error(`Cloudflare returned ${response.status}`);

      const payload = (await response.json()) as { iceServers?: IceServer[] };
      const managed = Array.isArray(payload.iceServers)
        ? payload.iceServers.filter((server) => server && server.urls)
        : [];
      if (!managed.length) throw new Error('Cloudflare returned no ICE servers');

      this.cloudflareCache = {
        servers: managed,
        expiresAt: Date.now() + CLOUDFLARE_TURN_CACHE_MS,
      };
      return [...servers, ...managed];
    } catch (error) {
      // Sem relay é pior, mas ainda conecta quem não precisa dele.
      this.logger.warn(
        `Could not generate managed TURN credentials: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    return servers;
  }
}
