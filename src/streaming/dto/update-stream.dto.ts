import { IsIn } from 'class-validator';

export class UpdateStreamDto {
  @IsIn(['MEMBERS', 'PUBLIC'])
  visibility: 'MEMBERS' | 'PUBLIC';
}
