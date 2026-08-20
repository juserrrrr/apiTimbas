import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateStreamDto {
  @IsString()
  @IsOptional()
  @MaxLength(80)
  title?: string;
}
