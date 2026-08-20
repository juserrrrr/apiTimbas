import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SignalDto {
  @IsString()
  @IsNotEmpty()
  from: string;

  @IsString()
  @IsNotEmpty()
  to: string;

  @IsIn(['offer', 'answer', 'ice'])
  type: 'offer' | 'answer' | 'ice';

  data: unknown;
}
