import { IsEmail } from 'class-validator';

export class AuthForgotDto {
  @IsEmail()
  email: string;
}
