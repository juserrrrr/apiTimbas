import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDate, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { DraftResultMode, TournamentFormat } from '@prisma/client';

export const TOURNAMENT_STAGES = ['REGISTRATION', 'STARTED', 'PARTIAL', 'FINISHED'] as const;
export const DRAFT_STAGES = ['SETUP', 'DRAFTING', 'ACTIVE', 'PLAYED'] as const;

export class DemoEaClubDto {
  @IsString()
  @MinLength(2)
  name!: string;
}

export class DemoEaHistoryDto {
  @IsString()
  @MinLength(1)
  clubId!: string;
}

export class DemoEaMatchLookupDto extends DemoEaHistoryDto {
  @IsString()
  @MinLength(1)
  externalMatchId!: string;
}

export class BuildEaFourGroupsTournamentDto extends DemoEaClubDto {
  @IsString()
  @MinLength(1)
  externalMatchId!: string;
}

export class CreateLiveEaTournamentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  name!: string;

  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(32)
  @IsString({ each: true })
  clubNames!: string[];

  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(8)
  groupCount!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  advancePerGroup!: number;
}

export class LiveEaGroupAssignmentDto {
  @IsString()
  teamId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(7)
  group!: number;
}

export class AssignLiveEaGroupsDto {
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => LiveEaGroupAssignmentDto)
  assignments!: LiveEaGroupAssignmentDto[];
}

export class BuildRealEaTournamentDto {
  @IsString()
  @MinLength(2)
  clubName!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(12)
  teamCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(40)
  maxMatches?: number;
}

export class DemoEaSyncDto {
  @IsString()
  tournamentId!: string;

  @IsString()
  matchId!: string;
}

export class PrepareDemoEaMatchDto {
  @IsString()
  tournamentId!: string;
  @IsString()
  matchId!: string;
  @IsString()
  clubId!: string;
  @IsString()
  externalMatchId!: string;
  @IsIn(['HOME', 'AWAY'])
  side!: 'HOME' | 'AWAY';
}

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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  bestOf?: number;

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
  @Max(20)
  rosterCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(11)
  @Max(26)
  rosterSize?: number;

  @IsOptional()
  @IsEnum(DraftResultMode)
  resultMode?: DraftResultMode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50000000000)
  startingBudget?: number;

  @IsOptional()
  @IsBoolean()
  paySalaries?: boolean;

  /// Times sem dono, para ver a liga rodando sem depender de gente.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(19)
  vacantRosters?: number;

  @IsOptional()
  @IsBoolean()
  auctionsEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(336)
  auctionHours?: number;

  @IsIn(DRAFT_STAGES)
  stage: (typeof DRAFT_STAGES)[number];
}
