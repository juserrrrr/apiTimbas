import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScoreReaderConfigService } from './score-reader-config.service';
import { ScoreReaderController } from './score-reader.controller';
import { ScoreReaderService } from './score-reader.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ScoreReaderController],
  providers: [ScoreReaderConfigService, ScoreReaderService],
  exports: [ScoreReaderService, ScoreReaderConfigService],
})
export class ScoreReaderModule {}
