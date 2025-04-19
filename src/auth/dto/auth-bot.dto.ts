import { IsString } from 'class-validator';

export class AuthBotDto {
  @IsString()
  botId: string;
}
