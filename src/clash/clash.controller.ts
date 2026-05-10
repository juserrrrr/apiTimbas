import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ClashService } from './clash.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ClashScoutRateLimitGuard } from './guards/clash-scout-rate-limit.guard';

@Controller('clash')
export class ClashController {
  constructor(private readonly clashService: ClashService) {}

  @UseGuards(AuthGuard, ClashScoutRateLimitGuard)
  @Get('scout')
  async scout(
    @Query('gameName') gameName: string,
    @Query('tagLine') tagLine: string,
  ) {
    if (!gameName || !tagLine) throw new BadRequestException('gameName e tagLine são obrigatórios');
    return this.clashService.scout(gameName, tagLine);
  }

  @UseGuards(AuthGuard)
  @Post('analysis')
  async saveAnalysis(@Body() data: any) {
    return this.clashService.saveAnalysis(data);
  }

  @Get('analysis/:id')
  async getAnalysis(@Param('id') id: string) {
    return this.clashService.getAnalysis(id);
  }
}
