import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAnnouncementChannelDto {
  @IsString()
  @MaxLength(32)
  guildId: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  channelId?: string;
}
