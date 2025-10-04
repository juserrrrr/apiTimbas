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
        // Criar o time azul
        const teamBlue = await prisma.teamLeague.create({
          data: {
            side: Side.BLUE,
            players: {
              create: createLeagueMatchDto.teamBlue.players.map((player) => ({
                user: {
                  connect: {
                    id: player.userId,
                  },
                },
              })),
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
              create: createLeagueMatchDto.teamRed.players.map((player) => ({
                user: {
                  connect: {
                    id: player.userId,
                  },
                },
              })),
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
