import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { ActorService } from '../common/actor.service';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { UpdateScoreReaderDto } from './dto/score-reader.dto';
import { ScoreReaderConfigService } from './score-reader-config.service';
import { ScoreReaderService } from './score-reader.service';

type AuthedRequest = Request & { tokenPayload?: { discordId?: string } };

@UseGuards(AuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('admin/score-reader')
export class ScoreReaderController {
  constructor(
    private readonly config: ScoreReaderConfigService,
    private readonly reader: ScoreReaderService,
    private readonly actor: ActorService,
  ) {}

  @Get()
  view() {
    return this.config.view();
  }

  @Patch()
  async update(@Req() req: AuthedRequest, @Body() dto: UpdateScoreReaderDto) {
    const actor = await this.actor.require(req.tokenPayload?.discordId);
    return this.config.update(dto, actor.discordId);
  }

  @Post('test')
  test() {
    return this.reader.test();
  }
}
