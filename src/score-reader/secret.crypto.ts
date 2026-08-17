import { InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT = 'timbas.score-reader.v1';

function key(): Buffer {
  const secret = process.env.SETTINGS_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new InternalServerErrorException('SETTINGS_SECRET ou JWT_SECRET não configurado.');
  return scryptSync(secret, SALT, 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string | null {
  const [iv, tag, data] = payload.split('.');
  if (!iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
