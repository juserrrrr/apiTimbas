import {
  IsString,
  IsEmail,
  IsStrongPassword,
  IsDateString,
  IsEmpty,
} from 'class-validator';

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

  @IsDateString()
  dateOfBirth: Date;

  @IsEmpty()
  dateCreated?: Date;

  @IsEmpty()
  dateUpdated?: Date;

  @IsString()
  discordId: string;

  @IsString()
  accountLolId: string;

  @IsString()
  accountValorantId: string;
}
