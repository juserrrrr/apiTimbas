import {
  IsString,
  IsEmail,
  IsStrongPassword,
  IsDateString,
  IsEmpty,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { Role } from '../../enums/role.enum';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsString()
  discordId: string;

  @IsString()
  @IsOptional()
  LeagueId?: string;

  @IsEmail()
  @IsOptional()
  email: string;

  @IsStrongPassword({
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  })
  @IsOptional()
  password: string;

  @IsOptional()
  @IsEnum(Role)
  role: string;

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
