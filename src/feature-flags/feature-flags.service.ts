import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FEATURE_TOURNAMENT_EA_AUTO_SYNC, KNOWN_FEATURE_FLAGS } from './feature-flags.constants';

const CACHE_TTL_MS = 15_000;

@Injectable()
export class FeatureFlagsService {
  private cache: { value: Map<string, boolean>; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const rows = await this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
    const byKey = new Map(rows.map((row) => [row.key, row]));

    return KNOWN_FEATURE_FLAGS.map((flag) => {
      const row = byKey.get(flag.key);
      return {
        key: flag.key,
        enabled: row?.enabled ?? false,
        description: row?.description ?? flag.description,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  async setEnabled(key: string, enabled: boolean) {
    const known = KNOWN_FEATURE_FLAGS.find((flag) => flag.key === key);
    if (!known) throw new NotFoundException(`Feature flag ${key} não existe.`);

    const row = await this.prisma.featureFlag.upsert({
      where: { key },
      update: { enabled },
      create: { key, enabled, description: known.description },
    });
    if (key === FEATURE_TOURNAMENT_EA_AUTO_SYNC && !enabled) {
      await this.prisma.tournamentMatch.updateMany({
        where: { eaNextCheckAt: { not: null } },
        data: { eaNextCheckAt: null, eaCheckMessage: 'Busca automática desativada pelo administrador.' },
      });
    }
    this.cache = null;
    return row;
  }

  async isEnabled(key: string): Promise<boolean> {
    if (!this.cache || this.cache.expiresAt < Date.now()) {
      const rows = await this.prisma.featureFlag.findMany();
      this.cache = {
        value: new Map(rows.map((row) => [row.key, row.enabled])),
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
    }
    return this.cache.value.get(key) ?? false;
  }

  async ensureEnabled(key: string) {
    if (!(await this.isEnabled(key))) {
      throw new ForbiddenException('Recurso desativado pelo administrador.');
    }
  }

  async getTournamentEaAutomationSettings() {
    return (await this.prisma.tournamentEaAutomationSettings.findUnique({ where: { id: 1 } })) ?? {
      id: 1,
      checkIntervalSeconds: 30,
      checksPerMinute: 2,
      lookbackMinutes: 0,
      updatedByDiscordId: null,
      updatedAt: null,
    };
  }

  updateTournamentEaAutomationSettings(
    checkIntervalSeconds: number,
    checksPerMinute: number,
    lookbackMinutes: number,
    updatedByDiscordId: string,
  ) {
    return this.prisma.tournamentEaAutomationSettings.upsert({
      where: { id: 1 },
      create: { id: 1, checkIntervalSeconds, checksPerMinute, lookbackMinutes, updatedByDiscordId },
      update: { checkIntervalSeconds, checksPerMinute, lookbackMinutes, updatedByDiscordId },
    });
  }
}
