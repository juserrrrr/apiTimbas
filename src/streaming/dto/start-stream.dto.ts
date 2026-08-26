import { IsBoolean, IsOptional } from 'class-validator';

export class StartStreamDto {
  /// Sem pedido explícito a live sobe em silêncio: o anúncio marca o servidor
  /// inteiro e não tem como desfazer.
  @IsOptional()
  @IsBoolean()
  announce?: boolean;
}
