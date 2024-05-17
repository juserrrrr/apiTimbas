import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { DiscordServerController } from './discordServer.controller';
import { DiscordServerService } from './discordServer.service';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [DiscordServerController],
  providers: [DiscordServerService],
  exports: [DiscordServerService],
})
export class DiscordServerModule {}
