import { PartialType } from '@nestjs/mapped-types';
import { CreateCustomLeagueMatchDto } from './create-leagueMatch.dto';
import { IsNumber, IsOptional } from 'class-validator';

export class UpdateCustomLeagueMatchDto extends PartialType(
  CreateCustomLeagueMatchDto,
) {
  @IsNumber()
  @IsOptional()
  winnerId?: number;
}
