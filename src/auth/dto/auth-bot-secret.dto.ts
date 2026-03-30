import { IsString } from 'class-validator';

export class AuthBotSecretDto {
  @IsString()
  secret: string;
}
