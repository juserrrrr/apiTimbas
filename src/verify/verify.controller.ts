import { Controller, Post, Get, Delete, Body, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { VerifyService } from './verify.service';
import { StartVerifyDto } from './dto/start-verify.dto';
import { ConfirmVerifyDto } from './dto/confirm-verify.dto';
import { AuthGuard } from '../auth/guards/auth.guard';

@UseGuards(AuthGuard)
@Controller('verify')
export class VerifyController {
  constructor(private readonly verifyService: VerifyService) {}

  @Post('start')
  async start(@Req() req: Request & { tokenPayload: any }, @Body() dto: StartVerifyDto) {
    const discordId: string = req.tokenPayload?.discordId;
    if (!discordId) throw new Error('Discord ID ausente no token');
    return this.verifyService.startVerification(discordId, dto);
  }

  @Post('confirm')
  async confirm(@Req() req: Request & { tokenPayload: any }, @Body() dto: ConfirmVerifyDto) {
    const discordId: string = req.tokenPayload?.discordId;
    if (!discordId) throw new Error('Discord ID ausente no token');
    return this.verifyService.confirmVerification(discordId, dto.pendingId);
  }

  @Get('status')
  async status(@Req() req: Request & { tokenPayload: any }) {
    const discordId: string = req.tokenPayload?.discordId;
    if (!discordId) throw new Error('Discord ID ausente no token');
    return this.verifyService.getStatus(discordId);
  }

  @Delete('unlink')
  async unlink(@Req() req: Request & { tokenPayload: any }) {
    const discordId: string = req.tokenPayload?.discordId;
    if (!discordId) throw new Error('Discord ID ausente no token');
    return this.verifyService.unlinkAccount(discordId);
  }
}
