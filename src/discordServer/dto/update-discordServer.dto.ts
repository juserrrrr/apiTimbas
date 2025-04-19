import { PartialType } from '@nestjs/mapped-types';
import { CreateDiscordServerDto } from './create-discordServer.dto';
import { IsString, IsOptional } from 'class-validator';

export class UpdateDiscordServerDto extends PartialType(
  CreateDiscordServerDto,
) {
  @IsString()
  @IsOptional()
  channelId?: string;
}
