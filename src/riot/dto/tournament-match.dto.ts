import { IsString, IsNumber, IsOptional } from 'class-validator';

export class TournamentMatchDto {
  @IsString()
  matchId: string;

  @IsString()
  tournamentCode: string;

  @IsNumber()
  gameId: number;

  @IsString()
  region: string;
}
