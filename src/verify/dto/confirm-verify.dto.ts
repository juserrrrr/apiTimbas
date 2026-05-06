import { IsString } from 'class-validator';

export class ConfirmVerifyDto {
  @IsString()
  pendingId: string;
}
