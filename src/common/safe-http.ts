import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { lookup } from 'dns/promises';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { isIP } from 'net';

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !isPrivateIpv4(address);
  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:'))
    return !isPrivateIpv4(normalized.slice(7));
  return !(
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:')
  );
}

export async function safeJsonGet(urlValue: string) {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new BadRequestException('A URL de origem Ã© invÃ¡lida.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new BadRequestException(
      'A URL deve usar HTTP ou HTTPS e nÃ£o pode conter credenciais.',
    );
  }

  const resolved = await lookup(url.hostname);
  if (!isPublicIp(resolved.address)) {
    throw new BadRequestException(
      'A URL de origem nÃ£o pode apontar para uma rede interna ou reservada.',
    );
  }
  const pinnedLookup = (_hostname, _options, callback) =>
    callback(null, resolved.address, resolved.family);

  return axios.get(url.toString(), {
    timeout: 30000,
    maxRedirects: 0,
    maxContentLength: 2 * 1024 * 1024,
    httpAgent: new HttpAgent({ lookup: pinnedLookup }),
    httpsAgent: new HttpsAgent({ lookup: pinnedLookup }),
  });
}
