import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CompetitionGame,
  CompetitionRole,
  TournamentFormat,
  TournamentAccessMode,
  TournamentStatus,
} from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTournamentDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(CompetitionGame)
  game?: CompetitionGame;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  gameLabel?: string;

  @IsOptional()
  @IsEnum(TournamentFormat)
  format?: TournamentFormat;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(64)
  maxTeams?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(11)
  teamSize?: number;

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

  @IsOptional()
  @IsBoolean()
  allowDraws?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  pointsWin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  pointsDraw?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  pointsLoss?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  coinsWin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  coinsDraw?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  coinsLoss?: number;

  @IsOptional()
  @IsBoolean()
  requireProof?: boolean;

  @IsOptional()
  @IsBoolean()
  requireOpponentConfirm?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  woAfterHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10080)
  matchWindowMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  graceMinutes?: number;

  @IsOptional()
  @IsBoolean()
  autoApproveProof?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(100)
  autoApproveMinConfidence?: number;

  @IsOptional()
  @IsEnum(TournamentAccessMode)
  accessMode?: TournamentAccessMode;

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => Array.isArray(value) ? value.map((item) => typeof item === 'string' ? item.trim() : item) : value)
  @IsString({ each: true })
  @MinLength(2, { each: true })
  @MaxLength(48, { each: true })
  invitedUsernames?: string[];

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(400)
  bannerUrl?: string;

  @IsOptional()
  @Type(() => Date)
  startsAt?: Date;

  @IsOptional()
  @Type(() => Date)
  registrationEndsAt?: Date;

  @IsOptional()
  @IsBoolean()
  autoStartOnClose?: boolean;
}

export class UpdateTournamentDto extends CreateTournamentDto {
  @IsOptional()
  declare name: string;

  @IsOptional()
  @IsEnum(TournamentStatus)
  status?: TournamentStatus;
}

export class ListTournamentsDto {
  @IsOptional()
  @IsEnum(TournamentStatus)
  status?: TournamentStatus;

  @IsOptional()
  @IsEnum(CompetitionGame)
  game?: CompetitionGame;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}

export class AddTeamDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  name: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(6)
  tag?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(400)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  eaClubId?: string;

  @IsOptional()
  @IsIn(['common-gen5'])
  eaPlatform?: 'common-gen5';

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  memberIds?: number[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  captainUsername?: string;
}

export class UpdateTeamDto extends AddTeamDto {
  @IsOptional()
  declare name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(64)
  seed?: number;
}

export class SeedEntryDto {
  @IsString()
  teamId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(64)
  seed: number;
}

export class SetSeedsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeedEntryDto)
  seeds: SeedEntryDto[];
}

export class StaffDto {
  @Type(() => Number)
  @IsInt()
  userId: number;

  @IsEnum(CompetitionRole)
  role: CompetitionRole;
}

export class ReportResultDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  homeScore: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  awayScore: number;

  @IsOptional()
  @IsString()
  @MaxLength(2_800_000)
  imageBase64?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  mimeType?: string;
}

export class ReviewProofDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(240)
  note?: string;
}

export class MatchMessageDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(600)
  body: string;
}

export class ProposeScheduleDto {
  @Type(() => Date)
  @IsDate()
  scheduledAt: Date;
}

export class RespondScheduleDto {
  @IsBoolean()
  accept: boolean;
}

export class ClaimResultDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  homeScore: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  awayScore: number;
}

export class RespondClaimDto {
  @IsBoolean()
  agree: boolean;
}

export class RequestMatchReviewDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason: string;
}

export class ResolveMatchReviewDto extends ClaimResultDto {}

export class ValidateTournamentEaClubDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  name: string;

  @IsOptional()
  @IsIn(['common-gen5'])
  platform?: 'common-gen5';
}

export class JoinByInviteDto {
  @Transform(trim)
  @IsString()
  @MinLength(16)
  @MaxLength(80)
  code: string;
}

export class ScheduleMatchDto {
  @Type(() => Date)
  @IsDate()
  scheduledAt: Date;
}

export class WalkoverDto {
  @IsString()
  winnerTeamId: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(240)
  reason?: string;
}
