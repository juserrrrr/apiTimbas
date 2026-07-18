import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ClashService } from './clash.service';
import { ScoutQueueService } from './scout-queue.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ClashScoutRateLimitGuard } from './guards/clash-scout-rate-limit.guard';

@Controller('clash')
export class ClashController {
  constructor(
    private readonly clashService: ClashService,
    private readonly scoutQueue: ScoutQueueService,
  ) {}

  // Enfileira um scout e retorna imediatamente o job — o frontend acompanha
  // via GET /clash/scout/jobs/:id sem segurar a conexão aberta.
  @UseGuards(AuthGuard, ClashScoutRateLimitGuard)
  @Post('scout')
  startScout(@Body() body: { gameName?: string; tagLine?: string; deep?: boolean }) {
    const gameName = body?.gameName?.trim();
    const tagLine = body?.tagLine?.trim();
    if (!gameName || !tagLine) throw new BadRequestException('gameName e tagLine são obrigatórios');
    return this.scoutQueue.enqueue(gameName, tagLine, body?.deep === true);
  }

  @UseGuards(AuthGuard)
  @Get('scout/jobs/:id')
  getScoutJob(@Param('id') id: string) {
    return this.scoutQueue.getJob(id);
  }

  // Rota síncrona legada — aguarda o scout inteiro na mesma conexão.
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
