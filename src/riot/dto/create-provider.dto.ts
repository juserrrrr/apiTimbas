import { IsString, IsUrl } from 'class-validator';

export class CreateProviderDto {
  @IsUrl()
  url: string;

  @IsString()
  region: string;
}
