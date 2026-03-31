import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { MatchType } from '@prisma/client';

export class CreateOnlineMatchDto {
  @IsString()
  @IsNotEmpty()
  discordServerId: string;

  @IsString()
  @IsNotEmpty()
  creatorDiscordId: string;

  @IsEnum(MatchType)
  @IsOptional()
  matchFormat?: MatchType;
}
