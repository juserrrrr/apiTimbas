import { IsString, IsNumber } from 'class-validator';

export class CreateTournamentDto {
  @IsString()
  name: string;

  @IsNumber()
  providerId: number;
}
