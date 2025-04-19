import { IsString } from 'class-validator';

export class CreateBotDto {
  @IsString()
  name: string;

  @IsString()
  discordId: string;
}
