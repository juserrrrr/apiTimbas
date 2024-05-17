import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateDiscordServerDto } from './dto/create-discordServer.dto';
import { UpdateDiscordServerDto } from './dto/update-discordServer.dto';
import { DiscordServerService } from './discordServer.service';

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
