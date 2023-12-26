import { Body, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateCustomLeagueMatchDto } from './dto/create-leagueMatch.dto';
import { UpdateCustomLeagueMatchDto } from './dto/update-leagueMatch.dto';
import { leagueMatchService } from './leagueMatch.service';

export class LeagueMatchController {
  constructor(private readonly leagueMatchService: leagueMatchService) {}

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
