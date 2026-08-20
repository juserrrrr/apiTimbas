import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateStreamDto {
  @IsString()
  @IsOptional()
  @MaxLength(80)
  title?: string;

  @IsString()
  @MaxLength(32)
  guildId: string;

  @IsIn(['MEMBERS', 'PUBLIC'])
  @IsOptional()
  visibility?: 'MEMBERS' | 'PUBLIC';
}
