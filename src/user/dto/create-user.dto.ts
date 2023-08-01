import { IsString, IsEmail, IsStrongPassword, IsDate } from 'class-validator';

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

  @IsDate()
  dateOfBirth: Date;

  @IsDate()
  dateCreated: Date;

  @IsDate()
  dateUpdated: Date;

  @IsString()
  accountLolId: string;

  @IsString()
  accountValorantId: string;
}
