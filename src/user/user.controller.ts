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
import { UpdateUserDto } from './dto/update-user.dto';
import { UserService } from './user.service';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/role.enum';
import { RoleGuard } from 'src/auth/guards/role.guard';
import { AuthGuard } from 'src/auth/guards/auth.guard';

@UseGuards(AuthGuard, RoleGuard)
@Roles(Role.Admin)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  async create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Get()
  async findAll() {
    return this.userService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findOne(id);
  }

  @Get('discord/:discordId')
  async findOneByDiscordId(@Param('discordId') discordId: string) {
    return this.userService.findOneByDiscordId(discordId);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.userService.update(id, updateUserDto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.userService.remove(id);
  }
}
