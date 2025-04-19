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
import { CreateCustomLeagueMatchDto } from './dto/create-leagueMatch.dto';
import { UpdateCustomLeagueMatchDto } from './dto/update-leagueMatch.dto';
import { LeagueMatchService } from './leagueMatch.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';

@UseGuards(AuthGuard, RoleGuard)
@Roles(Role.Admin, Role.Bot)
@Controller('leagueMatch')
export class LeagueMatchController {
  constructor(private readonly leagueMatchService: LeagueMatchService) {}

  @Post()
  async create(@Body() leagueMatchDto: CreateCustomLeagueMatchDto) {
    return this.leagueMatchService.create(leagueMatchDto);
  }

  @Get()
  async findAll() {
    return this.leagueMatchService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.leagueMatchService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() leagueMatchDto: UpdateCustomLeagueMatchDto,
  ) {
    return this.leagueMatchService.update(id, leagueMatchDto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.leagueMatchService.remove(id);
  }
}
