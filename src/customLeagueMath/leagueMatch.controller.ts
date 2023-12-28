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
import { CreateCustomLeagueMatchDto } from './dto/create-leagueMatch.dto';
import { UpdateCustomLeagueMatchDto } from './dto/update-leagueMatch.dto';
import { LeagueMatchService } from './leagueMatch.service';
import { AuthGuard } from 'src/auth/guards/auth.guard';
import { RoleGuard } from 'src/auth/guards/role.guard';
import { Role } from 'src/enums/role.enum';
import { Roles } from 'src/decorators/roles.decorator';

@UseGuards(AuthGuard, RoleGuard)
@Roles(Role.Admin)
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
  async findOne(@Param('id') id: string) {
    return this.leagueMatchService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() leagueMatchDto: UpdateCustomLeagueMatchDto,
  ) {
    return this.leagueMatchService.update(id, leagueMatchDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.leagueMatchService.remove(id);
  }
}
