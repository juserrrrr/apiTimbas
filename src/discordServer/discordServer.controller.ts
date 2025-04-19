import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { CreateDiscordServerDto } from './dto/create-discordServer.dto';
import { UpdateDiscordServerDto } from './dto/update-discordServer.dto';
import { DiscordServerService } from './discordServer.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';

@UseGuards(AuthGuard, RoleGuard)
@Roles(Role.Admin, Role.Bot)
@Controller('discordServer')
export class DiscordServerController {
  constructor(private readonly discordServerService: DiscordServerService) {}

  @Post()
  async create(@Body() createDiscordServerDto: CreateDiscordServerDto) {
    return this.discordServerService.create(createDiscordServerDto);
  }

  @Get()
  async findAll() {
    return this.discordServerService.findAll();
  }

  @Get(':id')
  async findByServerId(@Param('id', ParseIntPipe) serverId: number) {
    return this.discordServerService.findByServerId(serverId);
  }

  @Get('welcomeMsg/:id')
  async findWelcomeMsgByServerId(@Param('id', ParseIntPipe) serverId: number) {
    return this.discordServerService.findWelcomeMsgByServerId(serverId);
  }

  @Get('leaveMsg/:id')
  async findLeaveMsgByServerId(@Param('id', ParseIntPipe) serverId: number) {
    return this.discordServerService.findLeaveMsgByServerId(serverId);
  }

  @Get('banMsg/:id')
  async findBanMsgByServerId(@Param('id', ParseIntPipe) serverId: number) {
    return this.discordServerService.findBanMsgByServerId(serverId);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDiscordServerDto: UpdateDiscordServerDto,
  ) {
    return this.discordServerService.update(id, updateDiscordServerDto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.discordServerService.remove(id);
  }
}
