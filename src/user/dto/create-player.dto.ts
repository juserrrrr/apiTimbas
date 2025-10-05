import {
  IsString,
  IsEmail,
  IsDateString,
  IsEmpty,
  IsOptional,
} from 'class-validator';

export class CreatePlayerDto {
  @IsString()
  name: string;

  @IsString()
  discordId: string;

  @IsEmail()
  @IsOptional()
  email: string;

  @IsDateString()
  @IsOptional()
  dateOfBirth: string;

  @IsEmpty()
  dateCreated?: string;

  @IsEmpty()
  dateUpdated?: string;

  @IsEmpty()
  @IsOptional()
  teamLeagueIDs?: string[];
}
