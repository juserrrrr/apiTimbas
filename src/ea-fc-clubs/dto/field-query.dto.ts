import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';

export class EaFieldQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([5, 10, 15, 20, 25])
  matches = 25;
}
