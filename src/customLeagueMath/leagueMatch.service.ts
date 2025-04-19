import { UpdateCustomLeagueMatchDto } from './dto/update-leagueMatch.dto';
import { CreateCustomLeagueMatchDto, Side } from './dto/create-leagueMatch.dto';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../user/user.service';

@Injectable()
export class LeagueMatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
  ) {}

  async create(createLeagueMatchDto: CreateCustomLeagueMatchDto) {
    const teamBlueUsers = await Promise.all(
      createLeagueMatchDto.teamBlue.map((discordId) =>
        this.userService.findOneByDiscordId(discordId),
      ),
    );

    const teamRedUsers = await Promise.all(
      createLeagueMatchDto.teamRed.map((discordId) =>
        this.userService.findOneByDiscordId(discordId),
      ),
    );

    const teamBlue = await this.prisma.teamLeague.create({
      data: {
        side: Side.BLUE,
        players: {
          connect: teamBlueUsers.map((user) => ({
            id: user.id,
          })),
        },
      },
    });

    const teamRed = await this.prisma.teamLeague.create({
      data: {
        side: Side.RED,
        players: {
          connect: teamRedUsers.map((user) => ({
            id: user.id,
          })),
        },
      },
    });

    const leagueMatch = await this.prisma.customLeagueMatch.create({
      data: {
        winnerId: null,
        ServerDiscordId: createLeagueMatchDto.ServerDiscordId,
        Teams: {
          connect: [
            {
              id: teamBlue.id,
            },
            {
              id: teamRed.id,
            },
          ],
        },
        teamBlueId: teamBlue.id,
        teamRedId: teamRed.id,
      },
      include: {
        Teams: true,
      },
    });

    return leagueMatch;
  }

  async findAll() {
    return await this.prisma.customLeagueMatch.findMany({
      include: {
        Teams: true,
      },
    });
  }

  async findOne(id: number) {
    const match = await this.prisma.customLeagueMatch.findUnique({
      where: {
        id,
      },
    });
    if (match) {
      return match;
    }
    throw new NotFoundException(`League Match with id ${id} not found`);
  }

  async update(id: number, updateLeagueMatchDto: UpdateCustomLeagueMatchDto) {
    const winner = await this.prisma.teamLeague.findUnique({
      where: {
        id: Number(updateLeagueMatchDto.winnerId),
      },
    });

    if (!winner) {
      throw new NotFoundException(
        `Team with id ${updateLeagueMatchDto.winnerId} not found`,
      );
    }
    return await this.prisma.customLeagueMatch
      .update({
        where: {
          id,
        },
        data: {
          winnerId: Number(updateLeagueMatchDto.winnerId),
        },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          switch (err.code) {
            case 'P2025':
            case 'P2023':
              throw new NotFoundException(
                `League Match with id ${id} not found`,
              );
          }
        } else if (err instanceof Prisma.PrismaClientValidationError) {
          throw new BadRequestException(
            'One or more fields are invalid. Please check your input and try again.',
          );
        }
        console.log(err);
        throw new InternalServerErrorException(
          'An unexpected error occurred while trying to create the user',
        );
      });
  }

  async remove(id: number) {
    return await this.prisma.customLeagueMatch
      .delete({
        where: {
          id,
        },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          switch (err.code) {
            case 'P2025':
            case 'P2023':
              throw new NotFoundException(
                `League Match with id ${id} not found`,
              );
          }
        } else if (err instanceof Prisma.PrismaClientValidationError) {
          throw new BadRequestException(
            'One or more fields are invalid. Please check your input and try again.',
          );
        }
        console.log(err);
        throw new InternalServerErrorException(
          'An unexpected error occurred while trying to create the user',
        );
      });
  }
}
