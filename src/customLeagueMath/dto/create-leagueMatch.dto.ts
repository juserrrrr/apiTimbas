import { IsArray, IsEmpty, IsOptional, IsString } from 'class-validator';

//create enum for side, BLUE and RED
export enum Side {
  BLUE = 'BLUE',
  RED = 'RED',
}

export class CreateCustomLeagueMatchDto {
  @IsEmpty()
  id: string;

  @IsArray()
  teamBlue: string[];

  @IsArray()
  teamRed: string[];

  @IsString()
  @IsOptional()
  winnerId: string;

  @IsEmpty()
  dateCreated: Date;

  @IsEmpty()
  dateUpdated: Date;
}

// export class CreateCustomLeagueMatchDto {
//   @IsEmpty()
//   id: string;

//   @IsArray()
//   teams: TeamLeague[];

//   @IsString()
//   winnerId: string;

//   @IsEmpty()
//   dateCreated: Date;

//   @IsEmpty()
//   dateUpdated: Date;
// }
