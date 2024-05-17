import { IsEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDiscordServerDto {
  @IsEmpty()
  id: string;

  @IsString()
  discordServerId: string;

  @IsString()
  @IsOptional()
  welcomeMessage?: string;

  @IsString()
  @IsOptional()
  goodbyeMessage?: string;

  @IsString()
  @IsOptional()
  banMessage?: string;

  @IsEmpty()
  dateCreated: Date;

  @IsEmpty()
  dateUpdated: Date;
}
