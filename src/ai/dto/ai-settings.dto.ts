import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AiProvider, ScoreReadMode } from '@prisma/client';

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateAiSettingsDto {
  @IsOptional()
  @IsBoolean()
  analysisEnabled?: boolean;

  @IsOptional()
  @IsEnum(AiProvider)
  analysisProvider?: AiProvider;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  analysisModel?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  analysisFallbackModel?: string | null;

  @IsOptional()
  @IsBoolean()
  scoreReaderEnabled?: boolean;

  @IsOptional()
  @IsEnum(AiProvider)
  scoreReaderProvider?: AiProvider;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  scoreReaderModel?: string | null;

  @IsOptional()
  @IsEnum(ScoreReadMode)
  scoreReadMode?: ScoreReadMode;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z]{3}(\+[a-z]{3})*$/, { message: 'Use códigos de 3 letras, por exemplo por ou por+eng' })
  @MaxLength(40)
  ocrLanguage?: string;

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
