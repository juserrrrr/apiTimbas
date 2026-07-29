import { IsString, IsNotEmpty, IsEnum, IsOptional, IsInt, Min, Max } from 'class-validator';
import { MatchType, GameMode } from '@prisma/client';

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

  /** Modo de jogo (define o mapa). Padrão: CLASSIC (Summoner's Rift). */
  @IsEnum(GameMode)
  @IsOptional()
  gameMode?: GameMode;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  playersPerTeam?: number;
}
