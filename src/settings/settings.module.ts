import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsService } from './settings.service';
import { AwardCardSettingsService } from './award-card-settings.service';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';

@Module({
  imports: [PrismaModule],
  controllers: [AnnouncementController],
  providers: [SettingsService, AwardCardSettingsService, AnnouncementService],
  exports: [SettingsService, AwardCardSettingsService, AnnouncementService],
})
export class SettingsModule {}
