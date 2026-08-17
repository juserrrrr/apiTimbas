import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { ActorService } from '../common/actor.service';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { AiSettingsService } from './ai-settings.service';
import { ChatClient, describeAiError } from './chat.client';
import { UpdateAiSettingsDto } from './dto/ai-settings.dto';

type AuthedRequest = Request & { tokenPayload?: { discordId?: string } };

@UseGuards(AuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('admin/ai')
export class AiSettingsController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly chat: ChatClient,
    private readonly actor: ActorService,
  ) {}

  @Get()
  view() {
    return this.settings.view();
  }

  @Patch()
  async update(@Req() req: AuthedRequest, @Body() dto: UpdateAiSettingsDto) {
    const actor = await this.actor.require(req.tokenPayload?.discordId);
    return this.settings.update(dto, actor.discordId);
  }

  @Post('test')
  async test() {
    const analysis = await this.settings.analysis();
    if (!analysis.provider) {
      return this.settings.recordCheck(false, analysis.unavailableReason ?? 'Análise indisponível.');
    }

    try {
      const answer = await this.chat.complete({
        provider: analysis.provider,
        system: 'Responda apenas com JSON válido.',
        prompt: 'Responda exatamente {"ok":true}.',
        json: true,
        maxTokens: 32,
        timeoutMs: 20000,
      });
      const ok = answer.includes('"ok"');
      return this.settings.recordCheck(
        ok,
        ok
          ? `${analysis.provider.label} respondeu com ${analysis.provider.model}.`
          : `${analysis.provider.model} respondeu fora do formato esperado.`,
      );
    } catch (error) {
      return this.settings.recordCheck(false, describeAiError(error));
    }
  }
}
