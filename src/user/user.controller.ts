import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Patch,
  Delete,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserService } from './user.service';
import { Roles } from '../../src/decorators/roles.decorator';
import { Role } from '../../src/enums/role.enum';
import { RoleGuard } from '../../src/auth/guards/role.guard';
import { AuthGuard } from '../../src/auth/guards/auth.guard';

@UseGuards(AuthGuard, RoleGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Roles(Role.ADMIN, Role.BOT)
  @Post('player')
  async createPlayer(@Body() createPlayerDto: CreatePlayerDto) {
    return this.userService.createPlayer(createPlayerDto);
  }

  @Roles(Role.ADMIN)
  @Post('user')
  async createUser(@Body() createUserDto: CreateUserDto) {
    return this.userService.createUser(createUserDto);
  }

  @Roles(Role.ADMIN)
  @Get()
  async findAll() {
    return this.userService.findAll();
  }

  @Roles(Role.ADMIN)
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findOne(id);
  }

  @Roles(Role.ADMIN, Role.BOT)
  @Get('discord/:discordId')
  async findOneByDiscordId(@Param('discordId') discordId: string) {
    return this.userService.findOneByDiscordId(discordId);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.userService.update(id, updateUserDto);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.userService.remove(id);
  }
}
