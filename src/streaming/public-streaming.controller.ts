import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { RequireFeature } from '../decorators/feature.decorator';
import { FEATURE_SCREEN_SHARE } from '../feature-flags/feature-flags.constants';
import { FeatureFlagGuard } from '../feature-flags/guards/feature-flag.guard';
import { PublicPeerDto } from './dto/public-peer.dto';
import { PublicSignalDto } from './dto/public-signal.dto';
import { StreamingService } from './streaming.service';

@UseGuards(FeatureFlagGuard)
@RequireFeature(FEATURE_SCREEN_SHARE)
@Controller('streaming/public')
export class PublicStreamingController {
  constructor(private readonly streaming: StreamingService) {}

  @Get('ice')
  ice() {
    return { iceServers: this.streaming.iceServers() };
  }

  @Post('streams/:id/join')
  join(@Param('id') id: string) {
    return this.streaming.joinPublic(id);
  }

  @Post('streams/:id/leave')
  leave(@Param('id') id: string, @Body() dto: PublicPeerDto) {
    return this.streaming.leavePublic(id, dto.peerId, dto.guestToken);
  }

  @Post('streams/:id/signal')
  signal(@Param('id') id: string, @Body() dto: PublicSignalDto) {
    return this.streaming.publicSignal(id, dto);
  }

  @Post('streams/:id/events/ticket')
  ticket(@Param('id') id: string, @Body() dto: PublicPeerDto) {
    return this.streaming.createPublicTicket(id, dto.peerId, dto.guestToken);
  }

  @Get('streams/:id/events')
  events(
    @Param('id') id: string,
    @Query('ticket') ticket: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const peerId = ticket ? this.streaming.consumeTicket(ticket, id) : null;
    if (!peerId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'none');
    res.flushHeaders();
    res.write(': connected\n\n');

    let subject: ReturnType<StreamingService['attach']>;
    try {
      subject = this.streaming.attach(id, peerId);
    } catch {
      res.write(`data: ${JSON.stringify({ type: 'stream_ended' })}\n\n`);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({ type: 'ready', from: peerId })}\n\n`);
    const subscription = subject.subscribe({
      next: (event) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      complete: () => {
        if (!res.writableEnded) res.end();
      },
      error: () => {
        if (!res.writableEnded) res.end();
      },
    });

    this.streaming.announce(id, peerId);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
      else clearInterval(heartbeat);
    }, 25_000);
    const close = () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
      this.streaming.detach(id, peerId);
    };
    req.on?.('close', close);
    res.on('close', close);
  }
}
