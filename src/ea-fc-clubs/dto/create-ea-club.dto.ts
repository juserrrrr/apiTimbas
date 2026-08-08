import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { EA_FC_SUPPORTED_PLATFORMS } from '../ea-fc-clubs.types';

export class CreateEaClubDto {
  @IsString()
  @Matches(/^\d+$/)
  @Length(1, 32)
  externalClubId: string;

  @IsIn(EA_FC_SUPPORTED_PLATFORMS)
  @IsOptional()
  platform = 'common-gen5' as const;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  nickname?: string;
}

export class ValidateEaClubDto {
  @IsString()
  @Matches(/^\d+$/)
  @Length(1, 32)
  externalClubId: string;

  @IsIn(EA_FC_SUPPORTED_PLATFORMS)
  @IsOptional()
  platform = 'common-gen5' as const;
}

export class SearchEaClubsDto {
  @IsString()
  @Length(2, 100)
  name: string;

  @IsOptional()
  @IsIn(EA_FC_SUPPORTED_PLATFORMS)
  platform = 'common-gen5' as const;
}
