/**
 * Cache de chave/valor com validade curta, guardando a promessa e não o valor.
 *
 * Todo request autenticado repetia as mesmas consultas de usuário e permissão,
 * uma atrás da outra, e cada ida ao banco custa um round trip inteiro. Guardar
 * o resultado por alguns segundos derruba quase todas essas idas, e guardar a
 * promessa faz uma rajada de requests simultâneos virar uma consulta só.
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, { value: Promise<V>; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 1_000,
  ) {}

  async wrap(key: K, load: () => Promise<V>): Promise<V> {
    const now = Date.now();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now) return cached.value;

    const value = load();
    // Uma falha não pode ficar grudada no cache, senão o erro se repete até o
    // TTL vencer. O catch aqui também evita unhandled rejection quando quem
    // pediu já foi embora.
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });

    if (this.entries.size >= this.maxEntries) this.prune(now);
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    return value;
  }

  delete(key: K) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }

  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    // Cache cheio só de entrada viva: joga tudo fora em vez de crescer sem fim.
    if (this.entries.size >= this.maxEntries) this.entries.clear();
  }
}
