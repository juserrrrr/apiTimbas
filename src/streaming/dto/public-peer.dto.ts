import { IsNotEmpty, IsString } from 'class-validator';
import { PeerDto } from './peer.dto';

export class PublicPeerDto extends PeerDto {
  @IsString()
  @IsNotEmpty()
  guestToken: string;
}
