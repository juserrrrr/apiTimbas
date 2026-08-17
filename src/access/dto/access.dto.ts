import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserStatus } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class GroupDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  name: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  permissions?: string[];
}

export class UpdateGroupDto extends GroupDto {
  @IsOptional()
  declare name: string;
}

export class ReviewUserDto {
  @IsEnum(UserStatus)
  status: UserStatus;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class SetUserGroupsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  groupIds: string[];
}

export class ListUsersDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  search?: string;
}

export class PlatformSettingsDto {
  @IsOptional()
  @IsBoolean()
  requireApproval?: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  approvalMessage?: string;
}

export class PermissionCheckDto {
  @Type(() => String)
  @IsString()
  key: string;
}
