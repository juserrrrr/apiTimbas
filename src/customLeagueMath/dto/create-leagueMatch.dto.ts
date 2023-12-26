import { IsArray, IsEmpty, IsString } from 'class-validator';

//create enum for side, BLUE and RED
enum Side {
  BLUE = 'BLUE',
  RED = 'RED',
}

export interface TeamLeague {
  id: string;
  side: Side;
  PlayerIDs: string;
  customLeagueMatchId: string;
}

export class CreateCustomLeagueMatchDto {
  @IsEmpty()
  id: string;

  @IsArray()
  teams: TeamLeague[];

  @IsString()
  winnerId: string;

  @IsEmpty()
  dateCreated: Date;

  @IsEmpty()
  dateUpdated: Date;
}
