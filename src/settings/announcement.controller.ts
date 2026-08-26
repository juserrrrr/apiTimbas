import { Controller, Get } from '@nestjs/common';
import { AnnouncementService } from './announcement.service';

@Controller('announcements')
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get('latest')
  latest() {
    return this.announcements.latest();
  }
}
