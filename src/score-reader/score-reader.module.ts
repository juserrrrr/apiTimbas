import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ScoreReaderService } from './score-reader.service';

@Module({
  imports: [AiModule],
  providers: [ScoreReaderService],
  exports: [ScoreReaderService],
})
export class ScoreReaderModule {}
