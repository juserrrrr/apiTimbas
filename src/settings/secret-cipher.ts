import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto';
import { readFileSync } from 'fs';

const PREFIX = 'enc:';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

// Fixo de propósito: a mesma senha precisa gerar a mesma chave em todo boot,
// senão nada do que já foi salvo abre depois de um restart.
const DERIVATION_SALT = 'timbas-integration-settings-v1';

export interface EncryptionKey {
  /** Impressão digital da chave, não a chave. Vai junto do texto cifrado. */
  id: string;
  key: Buffer;
  source: 'explicit' | 'derived';
}

let cachedKeys: EncryptionKey[] | undefined;

/**
 * Chaves disponíveis, da principal para as antigas.
 *
 * `SETTINGS_ENCRYPTION_KEY` aceita uma lista separada por vírgula: a primeira
 * cifra, as demais só abrem o que foi cifrado antes. É assim que a rotação
 * acontece sem perder nada, do mesmo jeito que o Rails faz com a lista de
 * chaves do Active Record Encryption.
 *
 * `SETTINGS_ENCRYPTION_KEY_FILE` aponta para um arquivo com o mesmo conteúdo e
 * tem prioridade. Serve para a chave não ficar na lista de variáveis do painel,
 * onde ela aparece em print de tela e em `docker inspect`. Não protege contra
 * quem tem acesso ao servidor, porque o processo precisa conseguir ler.
 *
 * A chave derivada do `JWT_SECRET` entra sempre no fim da lista. Ela é o que
 * deixa a criptografia ligada sem configuração nenhuma, e continua abrindo o
 * que foi salvo antes de alguém definir uma chave dedicada.
 */
export function encryptionKeys(): EncryptionKey[] {
  if (cachedKeys !== undefined) return cachedKeys;

  const keys: EncryptionKey[] = [];

  for (const raw of readConfiguredKeys().split(',')) {
    const decoded = decodeKey(raw.trim());
    if (decoded) keys.push({ id: fingerprint(decoded), key: decoded, source: 'explicit' });
  }

  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (jwtSecret) {
    const derived = scryptSync(jwtSecret, DERIVATION_SALT, KEY_BYTES);
    keys.push({ id: fingerprint(derived), key: derived, source: 'derived' });
  }

  cachedKeys = keys;
  return cachedKeys;
}

export function primaryKey(): EncryptionKey | null {
  return encryptionKeys()[0] ?? null;
}

/** Só para os testes: o cache guarda o env lido na primeira chamada. */
export function resetEncryptionKeyCache() {
  cachedKeys = undefined;
}

function readConfiguredKeys() {
  const path = process.env.SETTINGS_ENCRYPTION_KEY_FILE?.trim();
  if (path) {
    try {
      return readFileSync(path, 'utf8').trim();
    } catch {
      // Cair para a variável é melhor do que subir sem criptografia nenhuma.
      // eslint-disable-next-line no-console
      console.warn(
        `SETTINGS_ENCRYPTION_KEY_FILE aponta para "${path}", que não pôde ser lido.`,
      );
    }
  }
  return process.env.SETTINGS_ENCRYPTION_KEY?.trim() ?? '';
}

function fingerprint(key: Buffer) {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function decodeKey(value: string): Buffer | null {
  if (!value) return null;
  const candidates = [
    /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, 'hex') : null,
    Buffer.from(value, 'base64'),
  ];
  return candidates.find((buffer) => buffer?.length === KEY_BYTES) ?? null;
}

export function isEncrypted(value: string) {
  return value.startsWith(PREFIX);
}

/**
 * O nome da configuração entra como dado autenticado. Sem isso, quem tivesse
 * escrita no banco poderia copiar o segredo cifrado do LiveKit para outra
 * linha e fazer a API usá-lo como se fosse outra coisa. Com AAD, o valor só
 * abre no campo em que foi gravado.
 */
export function encryptSecret(
  plain: string,
  context: string,
  key: EncryptionKey,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key.key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));

  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);

  return [
    `${PREFIX}v2`,
    key.id,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export interface DecryptedSecret {
  value: string;
  /** Null quando o valor é texto puro de antes da criptografia existir. */
  key: EncryptionKey | null;
}

/**
 * Valor sem prefixo é texto puro legado e volta como está, para ser cifrado no
 * próximo save. A chave usada volta junto porque quem chama precisa saber se o
 * valor foi aberto com uma chave antiga e merece ser regravado.
 */
export function decryptSecret(
  stored: string,
  context: string,
  keys: EncryptionKey[],
): DecryptedSecret {
  if (!isEncrypted(stored)) return { value: stored, key: null };
  if (!keys.length) throw new Error('Nenhuma chave de criptografia disponível.');

  const parts = stored.slice(PREFIX.length).split(':');
  const [version] = parts;
  if (version !== 'v2' || parts.length !== 5) {
    throw new Error('Valor cifrado com formato desconhecido.');
  }

  const [, keyId, iv, tag, ciphertext] = parts;
  // A impressão digital diz qual chave usar de primeira; as outras ficam de
  // reserva para o caso de duas chaves colidirem nos 8 caracteres.
  const ordered = [
    ...keys.filter((candidate) => matchesId(candidate.id, keyId)),
    ...keys.filter((candidate) => !matchesId(candidate.id, keyId)),
  ];

  for (const candidate of ordered) {
    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        candidate.key,
        Buffer.from(iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(context, 'utf8'));
      // GCM autentica: chave errada, contexto errado ou valor adulterado
      // explodem aqui no final().
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const value = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return { value, key: candidate };
    } catch {
      continue;
    }
  }

  throw new Error('Nenhuma chave disponível abre este valor.');
}

function matchesId(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
