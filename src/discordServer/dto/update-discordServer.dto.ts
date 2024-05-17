import { PartialType } from '@nestjs/mapped-types';
import { CreateDiscordServerDto } from './create-discordServer.dto';

export class UpdateDiscordServerDto extends PartialType(
  CreateDiscordServerDto,
) {}
