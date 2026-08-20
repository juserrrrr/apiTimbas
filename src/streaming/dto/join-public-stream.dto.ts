import { IsOptional, IsUUID } from 'class-validator';

export class JoinPublicStreamDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;
}
