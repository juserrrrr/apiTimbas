import { IsNotEmpty, IsString } from 'class-validator';

export class CreateDiscordServerDto {
  @IsString()
  @IsNotEmpty()
  discordServerId: string;
}
