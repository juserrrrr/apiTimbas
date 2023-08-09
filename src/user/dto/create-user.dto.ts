import {
  IsString,
  IsEmail,
  IsStrongPassword,
  IsDateString,
  IsEmpty,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { Role } from 'src/enums/role.enum';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsStrongPassword({
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  })
  password: string;

  @IsOptional()
  @IsEnum(Role)
  role: string;

  @IsDateString()
  dateOfBirth: string;

  @IsEmpty()
  dateCreated?: string;

  @IsEmpty()
  dateUpdated?: string;

  @IsString()
  @IsOptional()
  discordId: string;

  @IsString()
  @IsOptional()
  accountLolId?: string;

  @IsString()
  @IsOptional()
  accountValorantId?: string;
}
