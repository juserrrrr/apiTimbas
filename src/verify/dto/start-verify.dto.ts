import { IsString, Matches } from 'class-validator';

export class StartVerifyDto {
  @IsString()
  @Matches(/^.{3,16}#[a-zA-Z0-9]{3,5}$/, {
    message: 'riotId inválido. Use o formato Nome#TAG (ex: Gabriel#BR1)',
  })
  riotId: string;
}
