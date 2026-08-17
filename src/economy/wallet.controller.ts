import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard, RequirePermissions } from '../access/permission.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { ActorService } from '../common/actor.service';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { AdjustBalanceDto, RankingQueryDto, StatementQueryDto } from './dto/wallet.dto';
import { WalletService } from './wallet.service';

type AuthedRequest = Request & { tokenPayload?: { discordId?: string; role?: string } };

@UseGuards(AuthGuard, RoleGuard, PermissionGuard)
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly actor: ActorService,
  ) {}

  @Get()
  async balance(@Req() req: AuthedRequest) {
    const actor = await this.actor.require(req.tokenPayload?.discordId);
    return this.wallet.getBalance(actor.id);
  }

  @Get('statement')
  async statement(@Req() req: AuthedRequest, @Query() query: StatementQueryDto) {
    const actor = await this.actor.require(req.tokenPayload?.discordId);
    return this.wallet.statement(actor.id, query.take ?? 25, query.skip ?? 0);
  }

  @Get('ranking')
  ranking(@Query() query: RankingQueryDto) {
    return this.wallet.ranking(query.take ?? 20);
  }

  @Post('adjust')
  @RequirePermissions('economy.manage')
  adjust(@Body() dto: AdjustBalanceDto) {
    return this.wallet.adjust(dto.userId, dto.amount, dto.reason);
  }
}
