import { IsBoolean } from 'class-validator';

export class UpdateFeatureFlagDto {
  @IsBoolean()
  enabled: boolean;
}
