import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import {
  PermissionGuard,
  RequirePermissions,
} from '../access/permission.guard';
import { RequireFeature } from '../decorators/feature.decorator';
import { FeatureFlagGuard } from '../feature-flags/guards/feature-flag.guard';
import { FEATURE_LIVE_LIMIT_720P_30FPS, FEATURE_SCREEN_SHARE } from '../feature-flags/feature-flags.constants';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { CreateStreamDto } from './dto/create-stream.dto';
import { JoinStreamDto } from './dto/join-stream.dto';
import { StartStreamDto } from './dto/start-stream.dto';
import { PeerDto } from './dto/peer.dto';
import { SfuSettingsDto } from './dto/sfu-settings.dto';
import { ForceQualityDto } from './dto/force-quality.dto';
import { HostTelemetryDto } from './dto/host-telemetry.dto';
import { UpdateAnnouncementChannelDto } from './dto/update-announcement-channel.dto';
import { UpdateStreamDto } from './dto/update-stream.dto';
import {
  RequestUser,
  STREAM_MANAGE_PERMISSION,
  STREAM_PERMISSION,
  StreamingService,
} from './streaming.service';
import { LivekitService } from './livekit.service';

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
@RequirePermissions('dashboard.live')
@Controller('streaming')
export class StreamingController {
  constructor(
    private readonly streaming: StreamingService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly livekit: LivekitService,
  ) {}

  @Get('permission')
  async permission(@Req() req: any) {
    const user = toRequestUser(req);
    const { canStream } = await this.streaming.getPermission(user.id);
    return {
      canStream,
      featureEnabled: await this.featureFlags.isEnabled(FEATURE_SCREEN_SHARE),
      sfu: await this.livekit.isEnabled(),
      limit720p30fps: await this.featureFlags.isEnabled(FEATURE_LIVE_LIMIT_720P_30FPS),
    };
  }

  // ─── SFU ────────────────────────────────────────────────────────────────

  @RequirePermissions(STREAM_MANAGE_PERMISSION)
  @Get('admin/sfu')
  sfuStatus() {
    return this.livekit.status();
  }

  @RequirePermissions(STREAM_MANAGE_PERMISSION)
  @Put('admin/sfu')
  saveSfu(@Body() dto: SfuSettingsDto) {
    return this.livekit.save(dto);
  }

  @RequirePermissions(STREAM_MANAGE_PERMISSION)
  @Delete('admin/sfu')
  clearSfu() {
    return this.livekit.clear();
  }

  @RequirePermissions(STREAM_MANAGE_PERMISSION)
  @Post('admin/sfu/test')
  testSfu() {
    return this.livekit.test();
  }

  // ─── MONITOR ────────────────────────────────────────────────────────────

  /// Painel de depuração: estado do SFU, lives no ar, quem assiste cada uma e o
  /// que o servidor de mídia enxerga da sala.
  @RequirePermissions(STREAM_MANAGE_PERMISSION)
  @Get('admin/live')
  async adminLive() {
    const streams = this.streaming.adminOverview();
    const rooms = await Promise.all(
      streams.map((stream) => this.livekit.roomSnapshot(stream.slug)),
    );
    return {
      sfu: await this.livekit.status(),
      streams: streams.map((stream, index) => ({
        ...stream,
        room: rooms[index],
      })),
    };
  }

  @RequirePermissions(STREAM_MANAGE_PERMISSION)
  @Post('admin/streams/:id/quality')
  forceQuality(
    @Param('id') id: string,
    @Body() dto: ForceQualityDto,
    @Req() req: any,
  ) {
    return this.streaming.requestQuality(
      id,
      toRequestUser(req),
      dto.quality,
      dto.frameRate,
    );
  }

  // Credentials for the SFU. Returning `enabled: false` instead of an error
  // lets the browser fall back to the peer to peer transport untouched.
  @Post('streams/:id/rtc')
  async rtc(@Param('id') id: string, @Body() dto: PeerDto, @Req() req: any) {
    const grant = this.streaming.rtcGrant(id, dto.peerId, toRequestUser(req));
    const credentials = await this.livekit.credentials(grant);
    if (!credentials) return { enabled: false };
    return { enabled: true, role: grant.role, ...credentials };
  }

  @Get('streams')
  list(@Req() req: any) {
    return this.streaming.list(toRequestUser(req));
  }

  @RequirePermissions(STREAM_PERMISSION)
  @Post('streams')
  create(@Body() dto: CreateStreamDto, @Req() req: any) {
    return this.streaming.create(
      toRequestUser(req),
      dto.title,
      dto.guildId,
      dto.visibility,
    );
  }

  @RequirePermissions(STREAM_PERMISSION)
  @Post('streams/:id/start')
  start(
    @Param('id') id: string,
    @Body() dto: StartStreamDto,
    @Req() req: any,
  ) {
    return this.streaming.start(id, toRequestUser(req), dto?.announce ?? false);
  }

  @RequirePermissions(STREAM_PERMISSION)
  @Patch('streams/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStreamDto,
    @Req() req: any,
  ) {
    return this.streaming.updateStream(id, toRequestUser(req), dto);
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

  @RequirePermissions(STREAM_PERMISSION)
  @Get('streams/:id/viewers')
  viewers(@Param('id') id: string, @Req() req: any) {
    return this.streaming.viewers(id, toRequestUser(req));
  }

  @Delete('streams/:id')
  end(@Param('id') id: string, @Req() req: any) {
    return this.streaming.end(id, toRequestUser(req));
  }

  @Post('streams/:id/join')
  async join(
    @Param('id') id: string,
    @Body() dto: JoinStreamDto,
    @Req() req: any,
  ) {
    const session = this.streaming.join(
      id,
      toRequestUser(req),
      dto?.clientId,
      dto?.asViewer,
    );
    // Which transport this session will use is decided once, on join, so the
    // browser never has to guess or ask again.
    return { ...session, sfu: await this.livekit.isEnabled() };
  }

  @Post('streams/:id/leave')
  leave(@Param('id') id: string, @Body() dto: PeerDto, @Req() req: any) {
    return this.streaming.leave(id, dto.peerId, toRequestUser(req));
  }

  @Post('streams/:id/telemetry')
  telemetry(
    @Param('id') id: string,
    @Body() dto: HostTelemetryDto,
    @Req() req: any,
  ) {
    const { peerId, ...telemetry } = dto;
    return this.streaming.reportTelemetry(
      id,
      peerId,
      toRequestUser(req),
      telemetry,
    );
  }

  @Post('streams/:id/events/ticket')
  ticket(@Param('id') id: string, @Body() dto: PeerDto, @Req() req: any) {
    return this.streaming.createTicket(id, dto.peerId, toRequestUser(req));
  }
}
