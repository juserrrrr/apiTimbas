import { Module } from '@nestjs/common';
import { ClashService } from './clash.service';
import { ClashController } from './clash.controller';
import { RiotModule } from '../riot/riot.module';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
@Module({
  imports: [RiotModule, AiModule, AuthModule],
  controllers: [ClashController],
  providers: [ClashService],
})
export class ClashModule {}
