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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CatalogSource } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class CreateCompetitionDto {
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{2,20}$/, {
    message: 'code deve ter de 2 a 20 letras, números, hífen ou underline',
  })
  code: string;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  country?: string | null;

  @IsOptional()
  @IsEnum(CatalogSource)
  source?: CatalogSource;

  @IsOptional()
  @Transform(emptyToNull)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(400)
  sourcePath?: string | null;
}

export class UpdateCompetitionDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  country?: string | null;

  @IsOptional()
  @IsEnum(CatalogSource)
  source?: CatalogSource;

  @IsOptional()
  @Transform(emptyToNull)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(400)
  sourcePath?: string | null;

  @IsOptional()
  @IsBoolean()
  simulationEnabled?: boolean;
}

export class CreateTeamDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(8)
  shortName?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(400)
  crestUrl?: string | null;
}

export class UpdateTeamDto extends CreateTeamDto {
  @IsOptional()
  declare name: string;
}

export class CatalogPlayerInputDto {
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
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  nationality?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(400)
  photoUrl?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000000000)
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  pace?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  shooting?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  passing?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  dribbling?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  defending?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  physical?: number;
}

export class EstimateAttributesDto {
  @IsOptional()
  @IsBoolean()
  onlyMissing?: boolean;
}

/// Cadastro direto na base, sem escolher competição nem time.
export class CreatePlayerDto {
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
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(60)
  realTeam?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  nationality?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  overall?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000000000)
  price?: number;
}

export class ListBasePlayersDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  missingAttributes?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(400)
  take?: number;
}

export class EstimateMissingDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  limit?: number;
}

export class BulkPlayersDto {
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => CatalogPlayerInputDto)
  players: CatalogPlayerInputDto[];
}

export class UpdatePlayerDto extends CatalogPlayerInputDto {
  @IsOptional()
  declare name: string;

  @IsOptional()
  declare position: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class BulkTeamsDto {
  @IsArray()
  @ArrayMaxSize(120)
  @ValidateNested({ each: true })
  @Type(() => CreateTeamDto)
  teams: CreateTeamDto[];
}

export class SyncWikipediaSquadsDto {
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MinLength(2, { each: true })
  @MaxLength(100, { each: true })
  teams: string[];
}

export class ParseTextDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(40000)
  text: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  teamName?: string;
}

export class ExtractTeamsDto {
  @IsOptional()
  @IsString()
  @MaxLength(6_000_000)
  imageBase64?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  mimeType?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40000)
  text?: string;
}

export class ExtractSquadDto {
  @IsString()
  @MaxLength(6_000_000)
  imageBase64: string;

  @IsString()
  @MaxLength(40)
  mimeType: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  teamName?: string;
}

export class ImportToLeagueDto {
  @IsString()
  leagueId: string;

  /// Sem competição, vai a base inteira: ela é uma só.
  @IsOptional()
  @IsString()
  competitionId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  teamIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  minOverall?: number;

  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}
