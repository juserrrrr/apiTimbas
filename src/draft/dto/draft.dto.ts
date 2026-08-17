import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import {
  CompetitionRole,
  DraftLeagueStatus,
  DraftOrderType,
  DraftResultMode,
  TacticIntensity,
  TacticMentality,
  TransferOfferKind,
} from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateDraftLeagueDto {
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
  @IsEnum(DraftOrderType)
  orderType?: DraftOrderType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(26)
  rosterSize?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(16)
  formation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(3600)
  pickSeconds?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  matchDays?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  matchHour?: number;

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
  @Max(10000000)
  startingBudget?: number;

  @IsOptional()
  @IsBoolean()
  paySalaries?: boolean;

  @IsOptional()
  @IsBoolean()
  auctionsEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(336)
  auctionHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  auctionMinIncrementPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  auctionAntiSnipeMinutes?: number;

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
  @IsEnum(DraftResultMode)
  resultMode?: DraftResultMode;

  @IsOptional()
  @IsBoolean()
  transferWindowOpen?: boolean;

  @IsOptional()
  @IsBoolean()
  marketAutoManaged?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10080)
  marketClosesMinutesBefore?: number;

  /// Competições da base de onde esta liga aceita jogador. Lista vazia deixa a
  /// liga fechada no que já foi importado.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  sourceCompetitionIds?: string[];

  @IsOptional()
  @Type(() => Date)
  registrationEndsAt?: Date;

  @IsOptional()
  @IsBoolean()
  autoStartOnClose?: boolean;
}

export class UpdateDraftLeagueDto extends CreateDraftLeagueDto {
  @IsOptional()
  declare name: string;

  @IsOptional()
  @IsEnum(DraftLeagueStatus)
  status?: DraftLeagueStatus;
}

export class ListDraftLeaguesDto {
  @IsOptional()
  @IsEnum(DraftLeagueStatus)
  status?: DraftLeagueStatus;
}

export class JoinDraftDto {
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
}

export class DraftPlayerInputDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(12)
  position: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  overall?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  realTeam?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  nationality?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(400)
  photoUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  price?: number;
}

export class ImportPlayersDto {
  @IsArray()
  @ArrayMaxSize(600)
  @ValidateNested({ each: true })
  @Type(() => DraftPlayerInputDto)
  players: DraftPlayerInputDto[];

  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}

export class MakePickDto {
  @IsString()
  playerId: string;

  @IsOptional()
  @IsString()
  rosterId?: string;
}

export class LineupSlotDto {
  @IsString()
  playerId: string;

  @Transform(trim)
  @IsString()
  @MaxLength(12)
  slot: string;
}

export class SetLineupDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(16)
  formation?: string;

  @IsArray()
  @ArrayMaxSize(26)
  @ValidateNested({ each: true })
  @Type(() => LineupSlotDto)
  starters: LineupSlotDto[];
}

export class SetTacticsDto {
  @IsOptional()
  @IsString()
  rosterId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(16)
  formation?: string;

  @IsOptional()
  @IsEnum(TacticMentality)
  mentality?: TacticMentality;

  @IsOptional()
  @IsEnum(TacticIntensity)
  pressing?: TacticIntensity;

  @IsOptional()
  @IsEnum(TacticIntensity)
  tempo?: TacticIntensity;
}

export class CreateAuctionDto {
  @IsString()
  playerId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000000)
  startingBid?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(336)
  hours?: number;
}

export class PlaceBidDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000000)
  amount: number;
}

export class SignFromBaseDto {
  @IsString()
  catalogPlayerId: string;
}

export class BaseMarketQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  search?: string;

  @IsOptional()
  @IsString()
  competitionId?: string;
}

export class CreateOfferDto {
  @IsEnum(TransferOfferKind)
  kind: TransferOfferKind;

  @IsString()
  playerId: string;

  @IsOptional()
  @IsString()
  offeredPlayerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  price?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(240)
  message?: string;
}

export class RespondOfferDto {
  @IsBoolean()
  accept: boolean;
}

export class DraftStaffDto {
  @Type(() => Number)
  @IsInt()
  userId: number;

  @IsEnum(CompetitionRole)
  role: CompetitionRole;
}

export class ReviewDraftProofDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(240)
  note?: string;
}

export class ScorerDto {
  @IsString()
  playerId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  goals?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  assists?: number;
}

export class ReportDraftResultDto {
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

  /// Quem marcou e quem deu assistência. É o que alimenta a artilharia no modo
  /// real, onde o servidor não joga a partida e não sabe sozinho.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ScorerDto)
  scorers?: ScorerDto[];
}
