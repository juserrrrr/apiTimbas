import {
  IsArray,
  IsEmpty,
  IsNotEmpty,
  IsNumber,
  IsString,
} from 'class-validator';

export class UserTeamLeagueDto {
  @IsNumber()
  @IsNotEmpty()
  userId: number;
}

export class TeamLeagueDto {
  @IsArray()
  @IsNotEmpty()
  players: UserTeamLeagueDto[];
}

export class CreateCustomLeagueMatchDto {
  @IsEmpty()
  id?: string;

  @IsNotEmpty()
  teamBlue: TeamLeagueDto;

  @IsNotEmpty()
  teamRed: TeamLeagueDto;

  @IsString()
  @IsNotEmpty()
  ServerDiscordId: string;
}
