import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateCustomLeagueMatchDto } from './dto/update-leagueMatch.dto';
import { CreateCustomLeagueMatchDto, Side } from './dto/create-leagueMatch.dto';
import { UserService } from 'src/user/user.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

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
        playerIDs: teamBlueUsers.map((user) => user.id),
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
        playerIDs: teamRedUsers.map((user) => user.id),
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

  async findOne(id: string) {
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

  async update(id: string, updateLeagueMatchDto: UpdateCustomLeagueMatchDto) {
    const winner = await this.prisma.teamLeague.findUnique({
      where: {
        id: updateLeagueMatchDto.winnerId,
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
        data: updateLeagueMatchDto,
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          console.log(err);
          if (err.code === 'P2025' || err.code === 'P2023') {
            throw new NotFoundException(`League Match with id ${id} not found`);
          }
        }
      });
  }

  async remove(id: string) {
    return await this.prisma.customLeagueMatch
      .delete({
        where: {
          id,
        },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          console.log(err);
          if (err.code === 'P2025' || err.code === 'P2023') {
            throw new NotFoundException(`League Match with id ${id} not found`);
          }
        }
      });
  }
}
