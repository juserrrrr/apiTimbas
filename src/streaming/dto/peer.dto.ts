import { IsNotEmpty, IsString } from 'class-validator';

export class PeerDto {
  @IsString()
  @IsNotEmpty()
  peerId: string;
}
