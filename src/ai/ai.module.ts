import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AiProviderRegistry } from './ai-provider.registry';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';
import { AiService } from './ai.service';
import { ChatClient } from './chat.client';

@Module({
  imports: [PrismaModule, AuthModule, AccessModule],
  controllers: [AiSettingsController],
  providers: [AiService, AiProviderRegistry, AiSettingsService, ChatClient],
  exports: [AiService, AiProviderRegistry, AiSettingsService, ChatClient],
})
export class AiModule {}
