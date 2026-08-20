import { IsOptional, IsUUID } from 'class-validator';

export class JoinStreamDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;
}
