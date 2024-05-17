import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
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
  async create(@Body() DiscordServerDto: CreateDiscordServerDto) {
    return this.discordServerService.create(DiscordServerDto);
  }

  @Get()
  async findAll() {
    return this.discordServerService.findAll();
  }

  @Get(':id')
  async findByServerId(@Param('id') serverId: string) {
    return this.discordServerService.findByServerId(serverId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() DiscordServerDto: UpdateDiscordServerDto,
  ) {
    return this.discordServerService.update(id, DiscordServerDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.discordServerService.remove(id);
  }
}
