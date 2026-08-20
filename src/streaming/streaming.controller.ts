import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard, RequirePermissions } from '../access/permission.guard';
import { RequireFeature } from '../decorators/feature.decorator';
import { FeatureFlagGuard } from '../feature-flags/guards/feature-flag.guard';
import { FEATURE_SCREEN_SHARE } from '../feature-flags/feature-flags.constants';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { CreateStreamDto } from './dto/create-stream.dto';
import { PeerDto } from './dto/peer.dto';
import { SignalDto } from './dto/signal.dto';
import { UpdateAnnouncementChannelDto } from './dto/update-announcement-channel.dto';
import { RequestUser, STREAM_MANAGE_PERMISSION, STREAM_PERMISSION, StreamingService } from './streaming.service';

function toRequestUser(req: any): RequestUser {
  const payload = req.tokenPayload;
  return {
    id: Number(payload.id ?? payload.sub),
    name: payload.name,
    role: payload.role,
    avatar: payload.avatar ?? null,
    discordId: payload.discordId ?? null,
  };
}

@UseGuards(AuthGuard, FeatureFlagGuard, PermissionGuard)
@RequireFeature(FEATURE_SCREEN_SHARE)
@Controller('streaming')
export class StreamingController {
  constructor(
    private readonly streaming: StreamingService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  @Get('permission')
  async permission(@Req() req: any) {
    const user = toRequestUser(req);
    const { canStream } = await this.streaming.getPermission(user.id);
    return { canStream, featureEnabled: await this.featureFlags.isEnabled(FEATURE_SCREEN_SHARE) };
  }

  @Get('ice')
  ice() {
    return { iceServers: this.streaming.iceServers() };
  }

  @Get('streams')
  list() {
    return this.streaming.list();
  }

  @RequirePermissions(STREAM_PERMISSION)
  @Post('streams')
  create(@Body() dto: CreateStreamDto, @Req() req: any) {
    return this.streaming.create(toRequestUser(req), dto.title, dto.guildId, dto.visibility);
  }

  @RequirePermissions(STREAM_PERMISSION)
  @Post('streams/:id/start')
  start(@Param('id') id: string, @Req() req: any) {
    return this.streaming.start(id, toRequestUser(req));
  }

  @RequirePermissions(STREAM_MANAGE_PERMISSION)
  @Get('admin/announcement-channels')
  announcementGuilds() {
    return this.streaming.announcementGuilds();
  }

  @RequirePermissions(STREAM_PERMISSION)
  @Get('announcement-targets')
  announcementTargets() {
    return this.streaming.announcementTargets();
  }

  @RequirePermissions(STREAM_MANAGE_PERMISSION)
  @Post('admin/announcement-channels')
  setAnnouncementChannel(@Body() dto: UpdateAnnouncementChannelDto) {
    return this.streaming.setAnnouncementChannel(dto.guildId, dto.channelId);
  }

  @Get('streams/:id')
  findOne(@Param('id') id: string) {
    return this.streaming.findOne(id);
  }

  @Delete('streams/:id')
  end(@Param('id') id: string, @Req() req: any) {
    return this.streaming.end(id, toRequestUser(req));
  }

  @Post('streams/:id/join')
  join(@Param('id') id: string, @Req() req: any) {
    return this.streaming.join(id, toRequestUser(req));
  }

  @Post('streams/:id/leave')
  leave(@Param('id') id: string, @Body() dto: PeerDto, @Req() req: any) {
    return this.streaming.leave(id, dto.peerId, toRequestUser(req));
  }

  @Post('streams/:id/signal')
  signal(@Param('id') id: string, @Body() dto: SignalDto, @Req() req: any) {
    return this.streaming.signal(id, dto, toRequestUser(req));
  }

  @Post('streams/:id/events/ticket')
  ticket(@Param('id') id: string, @Body() dto: PeerDto, @Req() req: any) {
    return this.streaming.createTicket(id, dto.peerId, toRequestUser(req));
  }

  // EventSource cannot send an Authorization header, so the channel is opened
  // with a single-use ticket minted by the authenticated endpoint above.
  @Get('streams/:id/events')
  events(
    @Param('id') id: string,
    @Query('ticket') ticket: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const peerId = ticket ? this.streaming.consumeTicket(ticket, id) : null;
    if (!peerId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let subject: ReturnType<StreamingService['attach']>;
    try {
      subject = this.streaming.attach(id, peerId);
    } catch {
      res.write(`data: ${JSON.stringify({ type: 'stream_ended' })}\n\n`);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({ type: 'ready', from: peerId })}\n\n`);

    const subscription = subject.subscribe({
      next: (event) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      complete: () => {
        if (!res.writableEnded) res.end();
      },
      error: () => {
        if (!res.writableEnded) res.end();
      },
    });

    this.streaming.announce(id, peerId);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
      else clearInterval(heartbeat);
    }, 25000);

    const close = () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
      this.streaming.detach(id, peerId);
    };

    req.on?.('close', close);
    res.on('close', close);
  }
}
