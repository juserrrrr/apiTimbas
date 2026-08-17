import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DraftResultMode, TournamentFormat } from '@prisma/client';

export const TOURNAMENT_STAGES = ['REGISTRATION', 'STARTED', 'PARTIAL', 'FINISHED'] as const;
export const DRAFT_STAGES = ['SETUP', 'DRAFTING', 'ACTIVE', 'PLAYED'] as const;

export class BuildDemoTournamentDto {
  @IsOptional()
  @IsEnum(TournamentFormat)
  format?: TournamentFormat;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(32)
  teamCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(8)
  groupCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  advancePerGroup?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2)
  legs?: number;

  @IsOptional()
  @IsBoolean()
  thirdPlace?: boolean;

  @IsIn(TOURNAMENT_STAGES)
  stage: (typeof TOURNAMENT_STAGES)[number];
}

export class BuildDemoDraftDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(12)
  rosterCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(11)
  rosterSize?: number;

  @IsOptional()
  @IsEnum(DraftResultMode)
  resultMode?: DraftResultMode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000000)
  startingBudget?: number;

  @IsOptional()
  @IsBoolean()
  paySalaries?: boolean;

  @IsIn(DRAFT_STAGES)
  stage: (typeof DRAFT_STAGES)[number];
}
