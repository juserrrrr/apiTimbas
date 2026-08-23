import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  decryptSecret,
  encryptSecret,
  encryptionKeys,
  primaryKey,
} from './secret-cipher';

export interface EncryptionStatus {
  /** Há chave disponível, então o que for gravado vai cifrado. */
  active: boolean;
  /** Chave dedicada em SETTINGS_ENCRYPTION_KEY, e não derivada do JWT_SECRET. */
  dedicatedKey: boolean;
  /** Quantas chaves antigas ainda estão aceitas para leitura. */
  fallbackKeys: number;
}

/**
 * Configuração de integrações editada pelo painel.
 *
 * Tudo que passa por aqui é cifrado antes de chegar no banco, então um dump do
 * Postgres sozinho não entrega segredo nenhum. Quem tiver o servidor da API
 * continua tendo acesso, porque a chave mora lá: isso protege contra backup
 * vazado e acesso de leitura ao banco, não contra a máquina comprometida.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  encryptionStatus(): EncryptionStatus {
    const keys = encryptionKeys();
    return {
      active: keys.length > 0,
      dedicatedKey: keys[0]?.source === 'explicit',
      fallbackKeys: Math.max(0, keys.length - 1),
    };
  }

  /**
   * Valor que não abre é tratado como ausente, e não como erro fatal. É o que
   * acontece quando todas as chaves são trocadas de uma vez: o painel volta a
   * dizer "não configurado" e o admin digita de novo, em vez da API subir
   * quebrada.
   */
  async getMany(keys: string[]): Promise<Map<string, string>> {
    const available = encryptionKeys();
    const primary = primaryKey();
    const rows = await this.prisma.integrationSetting.findMany({
      where: { key: { in: keys } },
    });

    const values = new Map<string, string>();
    const stale: { key: string; value: string }[] = [];

    for (const row of rows) {
      try {
        const decrypted = decryptSecret(row.value, row.key, available);
        values.set(row.key, decrypted.value);

        // Aberto com chave antiga, ou ainda em texto puro. Regravar aqui é o
        // que faz a rotação se completar sozinha, sem tarefa manual.
        if (primary && decrypted.key?.id !== primary.id) {
          stale.push({ key: row.key, value: decrypted.value });
        }
      } catch {
        this.logger.warn(
          `Não foi possível decifrar a configuração "${row.key}". Ela precisa ser preenchida de novo no painel.`,
        );
      }
    }

    for (const entry of stale) {
      await this.set(entry.key, entry.value).catch(() => {
        this.logger.warn(`Não foi possível regravar "${entry.key}" com a chave atual.`);
      });
    }

    return values;
  }

  async set(key: string, value: string) {
    const primary = primaryKey();
    if (!primary) {
      this.logger.warn(
        `Configuração "${key}" salva em texto puro: nem SETTINGS_ENCRYPTION_KEY nem JWT_SECRET estão definidos.`,
      );
    }

    const stored = primary ? encryptSecret(value, key, primary) : value;
    await this.prisma.integrationSetting.upsert({
      where: { key },
      create: { key, value: stored },
      update: { value: stored },
    });
  }

  async remove(keys: string[]) {
    await this.prisma.integrationSetting.deleteMany({
      where: { key: { in: keys } },
    });
  }
}
