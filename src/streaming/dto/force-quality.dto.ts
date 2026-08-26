import { Type } from 'class-transformer';
import { IsIn, IsInt } from 'class-validator';

/// Alvo de qualidade que a organização empurra para o host enquanto depura uma
/// transmissão. Os valores espelham os perfis oferecidos no estúdio.
export class ForceQualityDto {
  @IsIn(['720p', '1080p', 'source'])
  quality: '720p' | '1080p' | 'source';

  @Type(() => Number)
  @IsInt()
  @IsIn([30, 60])
  frameRate: 30 | 60;
}
