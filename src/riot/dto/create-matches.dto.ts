import { IsNumber } from 'class-validator';

export class CreateMatchesDto {
  @IsNumber()
  count: number;
}
