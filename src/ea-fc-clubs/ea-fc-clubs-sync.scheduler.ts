import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EaFcClubsService } from './ea-fc-clubs.service';

@Injectable()
export class EaFcClubsSyncScheduler {
  private readonly logger = new Logger(EaFcClubsSyncScheduler.name);
  private running = false;

  constructor(
    private readonly clubsService: EaFcClubsService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES, {
    name: 'ea-fc-clubs-auto-sync',
  })
  async synchronizeClubs() {
    if (!this.isEnabled() || this.running) return;

    this.running = true;
    try {
      const results = await this.clubsService.syncAllClubs();
      const imported = results.reduce(
        (sum, result) => sum + result.imported,
        0,
      );
      const failed = results.filter((result) => result.error).length;
      this.logger.log(
        `Automatic EA FC sync finished: ${results.length} clubs, ${imported} new matches, ${failed} club failures`,
      );
    } catch (error) {
      this.logger.error(
        `Automatic EA FC sync failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      this.running = false;
    }
  }

  private isEnabled() {
    return (
      String(this.config.get('EA_FC_AUTO_SYNC_ENABLED') ?? 'true')
        .trim()
        .toLowerCase() !== 'false'
    );
  }
}
