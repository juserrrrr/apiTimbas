import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

/// Estado que o navegador de quem transmite reporta a cada poucos segundos.
export class HostTelemetryDto {
  @IsString()
  @IsNotEmpty()
  peerId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(8192)
  width: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(8192)
  height: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(480)
  fps: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200_000)
  kbps: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60_000)
  rttMs: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(8192)
  targetHeight: number;

  @IsIn(['none', 'cpu', 'bandwidth', 'other'])
  limitedBy: 'none' | 'cpu' | 'bandwidth' | 'other';
}
