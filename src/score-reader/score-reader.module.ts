import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { LocalOcrService } from './local-ocr.service';
import { ScoreReaderService } from './score-reader.service';

@Module({
  imports: [AiModule],
  providers: [ScoreReaderService, LocalOcrService],
  exports: [ScoreReaderService, LocalOcrService],
})
export class ScoreReaderModule {}
