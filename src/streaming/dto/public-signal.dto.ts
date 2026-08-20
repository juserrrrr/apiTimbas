import { IsNotEmpty, IsString } from 'class-validator';
import { SignalDto } from './signal.dto';

export class PublicSignalDto extends SignalDto {
  @IsString()
  @IsNotEmpty()
  guestToken: string;
}
