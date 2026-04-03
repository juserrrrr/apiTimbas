import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ParseIntPipe,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { CreateCustomLeagueMatchDto } from './dto/create-leagueMatch.dto';
import { UpdateCustomLeagueMatchDto } from './dto/update-leagueMatch.dto';
import { CreateOnlineMatchDto } from './dto/create-online-match.dto';
import { JoinMatchDto } from './dto/join-match.dto';
import { ActionMatchDto, FinishMatchDto } from './dto/action-match.dto';
import { LeagueMatchService } from './leagueMatch.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';

@Controller('leagueMatch')
export class LeagueMatchController {
  constructor(private readonly leagueMatchService: LeagueMatchService) {}

  // ─── OFFLINE CREATE ────────────────────────────────────────────────────────
  @UseGuards(AuthGuard, RoleGuard)
  @Roles(Role.ADMIN, Role.BOT)
  @Post()
  async create(@Body() leagueMatchDto: CreateCustomLeagueMatchDto) {
    return this.leagueMatchService.create(leagueMatchDto);
  }

  // ─── ONLINE LIFECYCLE ───────────────────────────────────────────────────
  @UseGuards(AuthGuard)
  @Post('online')
  async createOnline(@Body() dto: CreateOnlineMatchDto, @Req() req: any) {
    const tokenPayload = req.tokenPayload;
    if (tokenPayload?.role === Role.BOT) {
      if (!dto.creatorDiscordId) throw new BadRequestException('creatorDiscordId é obrigatório para BOT.');
    } else {
      if (!tokenPayload?.discordId) throw new BadRequestException('Usuário não identificado.');
      dto.creatorDiscordId = tokenPayload.discordId;
    }

    const match = await this.leagueMatchService.createOnline(dto);

    // Fire-and-forget: send embed to Discord guild channel
    this.leagueMatchService.announceMatchToGuild(
      match.id,
      dto.discordServerId,
      dto.matchFormat,
      match.playersPerTeam,
    ).catch(() => {});

    return match;
  }

  @UseGuards(AuthGuard)
  @Get('server/:serverId/active')
  async findActive(@Param('serverId') serverId: string) {
    return this.leagueMatchService.findActiveByServer(serverId);
  }

  @UseGuards(AuthGuard)
  @Post(':id/join')
  async join(@Param('id', ParseIntPipe) id: number, @Body() dto: JoinMatchDto, @Req() req: any) {
    const tokenPayload = req.tokenPayload;
    if (tokenPayload?.role !== Role.BOT && tokenPayload?.role !== Role.ADMIN) {
      if (tokenPayload?.discordId) dto.discordId = tokenPayload.discordId;
    }
    return this.leagueMatchService.join(id, dto);
  }

  @UseGuards(AuthGuard)
  @Delete(':id/leave')
  async leave(@Param('id', ParseIntPipe) id: number, @Body() body: { discordId: string }, @Req() req: any) {
    const tokenPayload = req.tokenPayload;
    let discordId = body.discordId;
    if (tokenPayload?.role !== Role.BOT && tokenPayload?.role !== Role.ADMIN) {
      discordId = tokenPayload?.discordId || discordId;
    }
    return this.leagueMatchService.leave(id, discordId);
  }

  @UseGuards(AuthGuard)
  @Post(':id/draw')
  async draw(@Param('id', ParseIntPipe) id: number, @Body() dto: ActionMatchDto, @Req() req: any) {
    const tokenPayload = req.tokenPayload;
    let requester = dto.requesterDiscordId;
    if (tokenPayload?.role !== Role.BOT && tokenPayload?.role !== Role.ADMIN) {
      requester = tokenPayload?.discordId || requester;
    }
    return this.leagueMatchService.draw(id, requester);
  }

  @UseGuards(AuthGuard)
  @Post(':id/start')
  async start(@Param('id', ParseIntPipe) id: number, @Body() dto: ActionMatchDto, @Req() req: any) {
    const tokenPayload = req.tokenPayload;
    let requester = dto.requesterDiscordId;
    if (tokenPayload?.role !== Role.BOT && tokenPayload?.role !== Role.ADMIN) {
      requester = tokenPayload?.discordId || requester;
    }
    return this.leagueMatchService.start(id, requester);
  }

  @UseGuards(AuthGuard)
  @Post(':id/move-to-room')
  async moveToRoom(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const tokenPayload = req.tokenPayload;
    const discordId = tokenPayload?.discordId;
    if (!discordId) {
      throw new BadRequestException('ID do Discord não encontrado no token.');
    }
    return this.leagueMatchService.moveToRoom(id, discordId);
  }

  @UseGuards(AuthGuard)
  @Post(':id/finish')
  async finish(@Param('id', ParseIntPipe) id: number, @Body() dto: FinishMatchDto, @Req() req: any) {
    const tokenPayload = req.tokenPayload;
    let requester = dto.requesterDiscordId;
    if (tokenPayload?.role !== Role.BOT && tokenPayload?.role !== Role.ADMIN) {
      requester = tokenPayload?.discordId || requester;
    }
    return this.leagueMatchService.finish(id, requester, dto.winner);
  }

  @UseGuards(AuthGuard)
  @Post(':id/cancel')
  async cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: ActionMatchDto, @Req() req: any) {
    const tokenPayload = req.tokenPayload;
    let requester = dto.requesterDiscordId;
    if (tokenPayload?.role !== Role.BOT && tokenPayload?.role !== Role.ADMIN) {
      requester = tokenPayload?.discordId || requester;
    }
    return this.leagueMatchService.cancel(id, requester);
  }

  @UseGuards(AuthGuard)
  @Post(':id/kick')
  async kickPlayer(@Param('id', ParseIntPipe) id: number, @Body() dto: { requesterDiscordId: string; targetDiscordId: string }, @Req() req: any) {
    const tokenPayload = req.tokenPayload;
    let requester = dto.requesterDiscordId;
    if (tokenPayload?.role !== Role.BOT && tokenPayload?.role !== Role.ADMIN) {
      requester = tokenPayload?.discordId || requester;
    }
    if (!dto.targetDiscordId) {
      throw new BadRequestException('ID do jogador a ser expulso é obrigatório.');
    }
    return this.leagueMatchService.kickPlayer(id, requester, dto.targetDiscordId);
  }

  @UseGuards(AuthGuard)
  @Post(':id/events/ticket')
  async createSseTicket(@Param('id', ParseIntPipe) id: number) {
    return { ticket: this.leagueMatchService.createSseTicket(id) };
  }

  @Get(':id/events')
  async sse(
    @Param('id', ParseIntPipe) id: number,
    @Query('ticket') ticket: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    if (!ticket || !this.leagueMatchService.validateAndConsumeSseTicket(ticket, id)) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const match = await this.leagueMatchService.findOne(id);
      res.write(`data: ${JSON.stringify({ type: 'state', payload: match })}\n\n`);
    } catch {
      res.write(`data: ${JSON.stringify({ type: 'error', payload: { message: 'Partida não encontrada' } })}\n\n`);
      res.end();
      return;
    }

    const subject = this.leagueMatchService.getOrCreateSubject(id);
    const subscription = subject.subscribe({
      next: (event) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`); },
      complete: () => { if (!res.writableEnded) res.end(); },
      error: () => { if (!res.writableEnded) res.end(); },
    });

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
      else clearInterval(heartbeat);
    }, 25000);

    req.on?.('close', () => { clearInterval(heartbeat); subscription.unsubscribe(); });
    res.on('close', () => { clearInterval(heartbeat); subscription.unsubscribe(); });
  }

  // ─── CRUD BÁSICO ─────────────────────────────────────────────────────────

  @UseGuards(AuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  @Get()
  async findAll() {
    return this.leagueMatchService.findAll();
  }

  @UseGuards(AuthGuard)
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.leagueMatchService.findOne(id);
  }

  @UseGuards(AuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomLeagueMatchDto) {
    return this.leagueMatchService.update(id, dto);
  }

  @UseGuards(AuthGuard, RoleGuard)
  @Roles(Role.ADMIN)
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.leagueMatchService.remove(id);
  }
}
