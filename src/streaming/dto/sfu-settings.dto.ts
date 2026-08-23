import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SfuSettingsDto {
  // The browser opens a WebSocket against this, so anything else is a typo the
  // admin should see before saving instead of debugging a silent live.
  @IsString()
  @Matches(/^wss?:\/\/.+/, {
    message: 'A URL precisa começar com wss:// (ou ws:// em rede local).',
  })
  @MaxLength(300)
  url: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  apiKey: string;

  /** Left empty on purpose when the admin is only editing the URL or the key. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  apiSecret?: string;
}
