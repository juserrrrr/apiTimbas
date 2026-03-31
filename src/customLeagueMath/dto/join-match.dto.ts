import { IsString, IsNotEmpty } from 'class-validator';

export class JoinMatchDto {
  @IsString()
  @IsNotEmpty()
  discordId: string;
}
