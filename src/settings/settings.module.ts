import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsService } from './settings.service';
import { AwardCardSettingsService } from './award-card-settings.service';

@Module({
  imports: [PrismaModule],
  providers: [SettingsService, AwardCardSettingsService],
  exports: [SettingsService, AwardCardSettingsService],
})
export class SettingsModule {}
