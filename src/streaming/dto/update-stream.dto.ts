import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateStreamDto {
  @IsIn(['MEMBERS', 'PUBLIC'])
  @IsOptional()
  visibility?: 'MEMBERS' | 'PUBLIC';

  /// Nome que aparece na lista, no link e no aviso do Discord. Quem transmite
  /// ajusta no mesmo modal onde escolhe imagem e som, antes de subir.
  @IsString()
  @IsOptional()
  @MaxLength(80)
  title?: string;
}
