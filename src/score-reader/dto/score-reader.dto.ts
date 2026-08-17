import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ScoreReaderProvider } from '@prisma/client';

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class UpdateScoreReaderDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(ScoreReaderProvider)
  provider?: ScoreReaderProvider;

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(300)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  apiKey?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(300)
  ocrBaseUrl?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  ocrApiKey?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  ocrEngine?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5000)
  @Max(120000)
  timeoutMs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(102400)
  @Max(16777216)
  maxImageBytes?: number;
}
