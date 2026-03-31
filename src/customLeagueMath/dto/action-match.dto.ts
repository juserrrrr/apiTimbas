import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { Side } from '@prisma/client';

export class ActionMatchDto {
  @IsString()
  @IsNotEmpty()
  requesterDiscordId: string;
}

export class FinishMatchDto extends ActionMatchDto {
  @IsEnum(Side)
  winner: Side;
}
