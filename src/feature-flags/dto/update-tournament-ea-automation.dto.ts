import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateTournamentEaAutomationDto {
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(3600)
  checkIntervalSeconds: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  checksPerMinute: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(240)
  lookbackMinutes: number;
}
