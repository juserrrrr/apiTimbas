import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ClashService } from './clash.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ClashScoutRateLimitGuard } from './guards/clash-scout-rate-limit.guard';

@UseGuards(AuthGuard)
@Controller('clash')
export class ClashController {
  constructor(private readonly clashService: ClashService) {}

  @Get('scout')
  @UseGuards(ClashScoutRateLimitGuard)
  async scout(
    @Query('gameName') gameName: string,
    @Query('tagLine') tagLine: string,
  ) {
    if (!gameName || !tagLine) throw new BadRequestException('gameName e tagLine são obrigatórios');
    return this.clashService.scout(gameName, tagLine);
  }
}
