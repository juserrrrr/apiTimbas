import { UpdateCustomLeagueMatchDto } from './dto/update-leagueMatch.dto';
import { CreateCustomLeagueMatchDto } from './dto/create-leagueMatch.dto';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Side } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class LeagueMatchService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createLeagueMatchDto: CreateCustomLeagueMatchDto) {
    try {
      return await this.prisma.$transaction(async (prisma) => {
        const mapPlayersToConnect = async (
          players: { userId?: number; discordId?: string }[],
        ) => {
          return Promise.all(
            players.map(async (player) => {
              if (player.userId) {
                return { user: { connect: { id: player.userId } } };
              }

              if (player.discordId) {
                const user = await prisma.user.findUnique({
                  where: { discordId: player.discordId },
                  select: { id: true },
                });
                if (!user) {
                  throw new NotFoundException(
                    `Usuário com discordId ${player.discordId} não encontrado`,
                  );
                }
                return { user: { connect: { id: user.id } } };
              }

              throw new BadRequestException(
                'Cada jogador deve ter um userId ou discordId.',
              );
            }),
          );
        };

        const teamBluePlayersConnect = await mapPlayersToConnect(
          createLeagueMatchDto.teamBlue.players,
        );
        const teamRedPlayersConnect = await mapPlayersToConnect(
          createLeagueMatchDto.teamRed.players,
        );

        // Criar o time azul
        const teamBlue = await prisma.teamLeague.create({
          data: {
            side: Side.BLUE,
            players: {
              create: teamBluePlayersConnect,
            },
          },
          include: {
            players: true,
          },
        });

        // Criar o time vermelho
        const teamRed = await prisma.teamLeague.create({
          data: {
            side: Side.RED,
            players: {
              create: teamRedPlayersConnect,
            },
          },
          include: {
            players: true,
          },
        });

        // Criar a partida
        const leagueMatch = await prisma.customLeagueMatch.create({
          data: {
            winnerId: null,
            riotMatchId: createLeagueMatchDto.riotMatchId,
            ServerDiscordId: createLeagueMatchDto.ServerDiscordId,
            teamBlueId: teamBlue.id,
            teamRedId: teamRed.id,
            Teams: {
              connect: [{ id: teamBlue.id }, { id: teamRed.id }],
            },
          },
          include: {
            Teams: {
              include: {
                players: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        discordId: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

        return leagueMatch;
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        switch (error.code) {
          case 'P2002':
            throw new BadRequestException(
              'Já existe uma partida com esses times',
            );
          case 'P2003':
            throw new BadRequestException(
              'Um ou mais jogadores não foram encontrados',
            );
          case 'P2025':
            throw new BadRequestException(
              'Um ou mais jogadores não foram encontrados',
            );
        }
      }
      throw new InternalServerErrorException('Erro ao criar a partida');
    }
  }

  async findAll() {
    return await this.prisma.customLeagueMatch.findMany({
      include: {
        Teams: {
          include: {
            players: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });
  }

  async findOne(id: number) {
    const match = await this.prisma.customLeagueMatch.findUnique({
      where: { id },
      include: {
        Teams: {
          include: {
            players: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!match) {
      throw new NotFoundException(`Partida com id ${id} não encontrada`);
    }

    return match;
  }

  async update(id: number, updateLeagueMatchDto: UpdateCustomLeagueMatchDto) {
    try {
      return await this.prisma.$transaction(async (prisma) => {
        return await prisma.customLeagueMatch.update({
          where: { id },
          data: {
            winnerId: updateLeagueMatchDto.winnerId
              ? Number(updateLeagueMatchDto.winnerId)
              : null,
            riotMatchId: updateLeagueMatchDto.riotMatchId,
          },
          include: {
            Teams: {
              include: {
                players: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        switch (error.code) {
          case 'P2025':
            throw new NotFoundException(`Partida com id ${id} não encontrada`);
        }
      }
      throw new InternalServerErrorException('Erro ao atualizar a partida');
    }
  }

  async remove(id: number) {
    try {
      return await this.prisma.$transaction(async (prisma) => {
        // Primeiro, encontrar a partida e seus times
        const match = await prisma.customLeagueMatch.findUnique({
          where: { id },
          include: {
            Teams: {
              include: {
                players: true,
              },
            },
          },
        });

        if (!match) {
          throw new NotFoundException(`Partida com id ${id} não encontrada`);
        }

        // Deletar os times e suas relações
        await Promise.all(
          match.Teams.map((team) =>
            prisma.teamLeague.delete({
              where: { id: team.id },
            }),
          ),
        );

        // Deletar a partida
        return await prisma.customLeagueMatch.delete({
          where: { id },
          include: {
            Teams: {
              include: {
                players: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        switch (error.code) {
          case 'P2025':
            throw new NotFoundException(`Partida com id ${id} não encontrada`);
        }
      }
      throw new InternalServerErrorException('Erro ao remover a partida');
    }
  }
}
