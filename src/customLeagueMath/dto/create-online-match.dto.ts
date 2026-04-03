import { IsString, IsNotEmpty, IsEnum, IsOptional, IsInt, Min, Max } from 'class-validator';
import { MatchType } from '@prisma/client';

export class CreateOnlineMatchDto {
  @IsString()
  @IsNotEmpty()
  discordServerId: string;

  @IsString()
  @IsOptional()
  creatorDiscordId?: string;

  @IsEnum(MatchType)
  @IsOptional()
  matchFormat?: MatchType;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  playersPerTeam?: number;
}
