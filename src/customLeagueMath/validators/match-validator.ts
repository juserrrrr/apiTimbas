import { BadRequestException } from '@nestjs/common';
import {
  CreateCustomLeagueMatchDto,
  MatchType,
} from '../dto/create-leagueMatch.dto';

export class MatchValidator {
  private static readonly VALID_POSITIONS = [
    'Top',
    'Jungle',
    'Mid',
    'ADC',
    'Suporte',
  ];

  /**
   * Valida se a partida está no formato correto para o Modo Aleatório Completo
   */
  static validateCompleteRandomMatch(dto: CreateCustomLeagueMatchDto): void {
    if (dto.matchType !== MatchType.ALEATORIO_COMPLETO) {
      return;
    }

    // Validar que cada jogador tem position
    this.validatePlayersHaveRequiredFields(dto);

    // Validar que cada time tem exatamente 5 posições únicas
    this.validateUniquePositions(dto.teamBlue.players, 'Time Azul');
    this.validateUniquePositions(dto.teamRed.players, 'Time Vermelho');

    // Validar que as posições são válidas
    this.validatePositionNames(dto);
  }

  /**
   * Valida se campos opcionais estão vazios quando não é Modo Aleatório Completo
   */
  static validateNonCompleteRandomMatch(dto: CreateCustomLeagueMatchDto): void {
    if (dto.matchType === MatchType.ALEATORIO_COMPLETO) {
      return;
    }

    // Para outros modos, position deve ser undefined/null
    const allPlayers = [...dto.teamBlue.players, ...dto.teamRed.players];

    allPlayers.forEach((player, index) => {
      if (player.position) {
        throw new BadRequestException(
          `Jogador ${
            index + 1
          }: O campo position só pode ser preenchido no Modo Aleatório Completo`,
        );
      }
    });
  }

  private static validatePlayersHaveRequiredFields(
    dto: CreateCustomLeagueMatchDto,
  ): void {
    const allPlayers = [...dto.teamBlue.players, ...dto.teamRed.players];

    allPlayers.forEach((player, index) => {
      if (!player.position) {
        throw new BadRequestException(
          `Jogador ${
            index + 1
          }: O campo position é obrigatório no Modo Aleatório Completo`,
        );
      }
    });
  }

  private static validateUniquePositions(
    players: any[],
    teamName: string,
  ): void {
    if (players.length !== 5) {
      throw new BadRequestException(
        `${teamName}: Deve ter exatamente 5 jogadores (recebido: ${players.length})`,
      );
    }

    const positions = players.map((p) => p.position);
    const uniquePositions = new Set(positions);

    if (uniquePositions.size !== 5) {
      throw new BadRequestException(
        `${teamName}: Cada posição deve aparecer apenas uma vez. Posições encontradas: ${positions.join(
          ', ',
        )}`,
      );
    }

    // Verificar se todas as posições estão presentes
    const missingPositions = this.VALID_POSITIONS.filter(
      (pos) => !positions.includes(pos),
    );
    if (missingPositions.length > 0) {
      throw new BadRequestException(
        `${teamName}: Posições faltando: ${missingPositions.join(', ')}`,
      );
    }
  }

  private static validatePositionNames(dto: CreateCustomLeagueMatchDto): void {
    const allPlayers = [...dto.teamBlue.players, ...dto.teamRed.players];

    allPlayers.forEach((player) => {
      if (!this.VALID_POSITIONS.includes(player.position!)) {
        throw new BadRequestException(
          `Posição inválida: "${
            player.position
          }". Posições válidas: ${this.VALID_POSITIONS.join(', ')}`,
        );
      }
    });
  }
}
