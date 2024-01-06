import { PartialType } from '@nestjs/mapped-types';
import { CreateCustomLeagueMatchDto } from './create-leagueMatch.dto';

export class UpdateCustomLeagueMatchDto extends PartialType(
  CreateCustomLeagueMatchDto,
) {}
