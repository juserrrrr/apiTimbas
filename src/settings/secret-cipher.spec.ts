import {
  decryptSecret,
  encryptSecret,
  encryptionKeys,
  isEncrypted,
  primaryKey,
  resetEncryptionKeyCache,
} from './secret-cipher';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const CONTEXT = 'livekit.apiSecret';

describe('secret cipher', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEncryptionKeyCache();
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    delete process.env.JWT_SECRET;
  });

  afterAll(() => {
    process.env = originalEnv;
    resetEncryptionKeyCache();
  });

  it('devolve o mesmo texto depois de cifrar e decifrar', () => {
    process.env.JWT_SECRET = 'um-segredo-de-jwt-bem-longo';
    const key = primaryKey()!;

    const encrypted = encryptSecret('APIsecret123', CONTEXT, key);

    expect(isEncrypted(encrypted)).toBe(true);
    expect(encrypted).not.toContain('APIsecret123');
    expect(decryptSecret(encrypted, CONTEXT, encryptionKeys()).value).toBe('APIsecret123');
  });

  it('gera saídas diferentes para o mesmo texto', () => {
    process.env.JWT_SECRET = 'um-segredo-de-jwt-bem-longo';
    const key = primaryKey()!;

    // IV aleatório por chamada: dois campos com o mesmo valor não podem ficar
    // idênticos no banco, senão dá para comparar linhas sem decifrar nada.
    expect(encryptSecret('igual', CONTEXT, key)).not.toBe(
      encryptSecret('igual', CONTEXT, key),
    );
  });

  it('recusa abrir o valor em outro campo', () => {
    process.env.JWT_SECRET = 'um-segredo-de-jwt-bem-longo';
    const encrypted = encryptSecret('APIsecret123', CONTEXT, primaryKey()!);

    // Copiar a linha cifrada para outra chave no banco não funciona.
    expect(() => decryptSecret(encrypted, 'outra.config', encryptionKeys())).toThrow();
  });

  it('recusa valor adulterado', () => {
    process.env.JWT_SECRET = 'um-segredo-de-jwt-bem-longo';
    const encrypted = encryptSecret('APIsecret123', CONTEXT, primaryKey()!);
    const tampered = `${encrypted.slice(0, -4)}AAAA`;

    expect(() => decryptSecret(tampered, CONTEXT, encryptionKeys())).toThrow();
  });

  it('abre com chave antiga depois de uma rotação', () => {
    process.env.SETTINGS_ENCRYPTION_KEY = KEY_B;
    const oldValue = encryptSecret('APIsecret123', CONTEXT, primaryKey()!);

    // A chave nova entra na frente e a antiga continua na lista.
    resetEncryptionKeyCache();
    process.env.SETTINGS_ENCRYPTION_KEY = `${KEY_A},${KEY_B}`;

    const decrypted = decryptSecret(oldValue, CONTEXT, encryptionKeys());
    expect(decrypted.value).toBe('APIsecret123');
    expect(decrypted.key!.id).not.toBe(primaryKey()!.id);
  });

  it('para de abrir quando a chave antiga sai da lista', () => {
    process.env.SETTINGS_ENCRYPTION_KEY = KEY_B;
    const oldValue = encryptSecret('APIsecret123', CONTEXT, primaryKey()!);

    resetEncryptionKeyCache();
    process.env.SETTINGS_ENCRYPTION_KEY = KEY_A;

    expect(() => decryptSecret(oldValue, CONTEXT, encryptionKeys())).toThrow();
  });

  it('deixa passar valor antigo em texto puro', () => {
    process.env.JWT_SECRET = 'um-segredo-de-jwt-bem-longo';

    const decrypted = decryptSecret('valor-antigo', CONTEXT, encryptionKeys());
    expect(decrypted.value).toBe('valor-antigo');
    expect(decrypted.key).toBeNull();
  });

  it('prefere a chave dedicada e mantém a derivada como reserva', () => {
    process.env.JWT_SECRET = 'um-segredo-de-jwt-bem-longo';
    process.env.SETTINGS_ENCRYPTION_KEY = KEY_A;

    const keys = encryptionKeys();
    expect(keys).toHaveLength(2);
    expect(keys[0].source).toBe('explicit');
    expect(keys[1].source).toBe('derived');
  });

  it('fica sem chave quando não há nada configurado', () => {
    expect(encryptionKeys()).toHaveLength(0);
    expect(primaryKey()).toBeNull();
  });
});
