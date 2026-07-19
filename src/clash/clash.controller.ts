import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ClashService } from './clash.service';
import { ScoutQueueService } from './scout-queue.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ClashScoutRateLimitGuard } from './guards/clash-scout-rate-limit.guard';
import { FullPlayerData } from '../ai/ai.service';

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

  @UseGuards(AuthGuard, ClashScoutRateLimitGuard)
  @Post('analysis/retry-ai')
  async retryAiAnalysis(@Body() body: { players?: FullPlayerData[] }) {
    if (!Array.isArray(body?.players) || body.players.length < 1 || body.players.length > 5) {
      throw new BadRequestException('Envie de 1 a 5 jogadores para tentar a análise novamente.');
    }
    return this.clashService.retryAiAnalysis(body.players);
  }

  @UseGuards(AuthGuard)
  @Get('analyses/recent')
  async getRecentAnalyses(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    return this.clashService.getRecentAnalyses(Number.isFinite(parsed) && parsed > 0 ? parsed : 8);
  }

  @Get('analysis/:id')
  async getAnalysis(@Param('id') id: string) {
    return this.clashService.getAnalysis(id);
  }
}
