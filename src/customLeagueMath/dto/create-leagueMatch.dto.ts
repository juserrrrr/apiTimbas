import {
  IsArray,
  IsEmpty,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class UserTeamLeagueDto {
  @IsOptional()
  @IsInt()
  userId?: number;

  @IsOptional()
  @IsString()
  discordId?: string;
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

  @IsNotEmpty()
  teamBlue: TeamLeagueDto;

  @IsNotEmpty()
  teamRed: TeamLeagueDto;

  @IsString()
  @IsNotEmpty()
  ServerDiscordId: string;
}
