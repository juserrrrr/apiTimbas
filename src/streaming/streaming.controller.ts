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
import { FEATURE_SCREEN_SHARE } from '../feature-flags/feature-flags.constants';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { CreateStreamDto } from './dto/create-stream.dto';
import { JoinStreamDto } from './dto/join-stream.dto';
import { PeerDto } from './dto/peer.dto';
import { SfuSettingsDto } from './dto/sfu-settings.dto';
import { SignalDto } from './dto/signal.dto';
import { UpdateAnnouncementChannelDto } from './dto/update-announcement-channel.dto';
import { UpdateStreamDto } from './dto/update-stream.dto';
import {
  RequestUser,
  STREAM_MANAGE_PERMISSION,
  STREAM_PERMISSION,
  StreamingService,
} from './streaming.service';
import { LivekitService } from './livekit.service';
import { TurnService } from './turn.service';

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
    private readonly livekit: LivekitService,
    private readonly turn: TurnService,
  ) {}

  @Get('permission')
  async permission(@Req() req: any) {
    const user = toRequestUser(req);
    const { canStream } = await this.streaming.getPermission(user.id);
    return {
      canStream,
      featureEnabled: await this.featureFlags.isEnabled(FEATURE_SCREEN_SHARE),
      sfu: await this.livekit.isEnabled(),
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

  @Post('streams/:id/signal')
  signal(@Param('id') id: string, @Body() dto: SignalDto, @Req() req: any) {
    return this.streaming.signal(id, dto, toRequestUser(req));
  }

  @Post('streams/:id/events/ticket')
  ticket(@Param('id') id: string, @Body() dto: PeerDto, @Req() req: any) {
    return this.streaming.createTicket(id, dto.peerId, toRequestUser(req));
  }
}
