import {
  IsArray,
  IsEmpty,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsString,
  IsEnum,
} from 'class-validator';
import { MatchType } from '@prisma/client';

export { MatchType };

export class UserTeamLeagueDto {
  @IsOptional()
  @IsInt()
  userId?: number;

  @IsOptional()
  @IsString()
  discordId?: string;

  @IsOptional()
  @IsString()
  position?: string;
}

export class TeamLeagueDto {
  @IsArray()
  @IsNotEmpty()
  players: UserTeamLeagueDto[];
}

export class CreateCustomLeagueMatchDto {
  @IsEmpty()
  id?: string;

  @IsString()
  @IsNotEmpty()
  riotMatchId: string;

  @IsOptional()
  @IsEnum(MatchType)
  matchType?: MatchType;

  @IsNotEmpty()
  teamBlue: TeamLeagueDto;

  @IsNotEmpty()
  teamRed: TeamLeagueDto;

  @IsString()
  @IsNotEmpty()
  ServerDiscordId: string;
}
