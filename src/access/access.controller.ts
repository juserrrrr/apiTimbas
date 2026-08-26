import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ActorService } from '../common/actor.service';
import { AccessService } from './access.service';
import { AuthService } from '../auth/auth.service';
import { PermissionGuard, RequirePermissions } from './permission.guard';
import {
  GroupDto,
  ListUsersDto,
  PlatformSettingsDto,
  ReviewUserDto,
  SetUserGroupsDto,
  UpdateGroupDto,
} from './dto/access.dto';

type AuthedRequest = Request & { tokenPayload?: { discordId?: string } };

@UseGuards(AuthGuard, PermissionGuard)
@Controller('admin/access')
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly actor: ActorService,
    private readonly auth: AuthService,
  ) {}

  /// Quem está logado descobre aqui o que pode fazer, e a tela monta o menu com
  /// isso em vez de adivinhar pelo cargo.
  @Get('me')
  async me(@Req() req: AuthedRequest) {
    const actor = await this.actor.require(req.tokenPayload?.discordId);
    return this.access.permissionsOf(actor.id);
  }

  @Get('catalog')
  @RequirePermissions('groups.manage', 'users.approve')
  catalog() {
    return this.access.catalog();
  }

  @Get('settings')
  @RequirePermissions('users.approve')
  settings() {
    return this.access.settings();
  }

  @Patch('settings')
  @RequirePermissions('users.approve')
  async updateSettings(@Req() req: AuthedRequest, @Body() dto: PlatformSettingsDto) {
    const actor = await this.actor.require(req.tokenPayload?.discordId);
    return this.access.updateSettings(dto, actor.discordId);
  }

  @Get('groups')
  @RequirePermissions('groups.manage', 'users.manage')
  groups() {
    return this.access.listGroups();
  }

  @Post('groups')
  @RequirePermissions('groups.manage')
  createGroup(@Body() dto: GroupDto) {
    return this.access.createGroup(dto);
  }

  @Patch('groups/:id')
  @RequirePermissions('groups.manage')
  updateGroup(@Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.access.updateGroup(id, dto);
  }

  @Delete('groups/:id')
  @RequirePermissions('groups.manage')
  removeGroup(@Param('id') id: string) {
    return this.access.removeGroup(id);
  }

  @Get('users')
  @RequirePermissions('users.approve', 'users.manage')
  users(@Query() query: ListUsersDto) {
    return this.access.listUsers(query);
  }

  @Post('users/:userId/review')
  @RequirePermissions('users.approve')
  async reviewUser(
    @Req() req: AuthedRequest,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: ReviewUserDto,
  ) {
    const reviewer = await this.actor.require(req.tokenPayload?.discordId);
    return this.access.reviewUser(userId, dto, reviewer.id);
  }

  @Post('users/:userId/groups')
  @RequirePermissions('users.manage')
  setUserGroups(@Param('userId', ParseIntPipe) userId: number, @Body() dto: SetUserGroupsDto) {
    return this.access.setUserGroups(userId, dto);
  }

  @Post('users/:userId/impersonate')
  @RequirePermissions('users.manage')
  async impersonate(@Req() req: AuthedRequest, @Param('userId', ParseIntPipe) userId: number) {
    const admin = await this.actor.require(req.tokenPayload?.discordId);
    return this.auth.createImpersonationToken(admin.id, userId);
  }
}
