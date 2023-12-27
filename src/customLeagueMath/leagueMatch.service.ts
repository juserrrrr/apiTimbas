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
      },
    });

    const teamRed = await this.prisma.teamLeague.create({
      data: {
        side: Side.RED,
        playerIDs: teamRedUsers.map((user) => user.id),
      },
    });

    const leagueMatch = await this.prisma.customLeagueMatch.create({
      data: {
        winnerId: null,
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

  async setWinnerId(id: string, winnerId: string) {
    //validate winnerId exits
    const winner = await this.prisma.teamLeague.findUnique({
      where: {
        id: winnerId,
      },
    });

    if (!winner) {
      throw new NotFoundException(`Team with id ${winnerId} not found`);
    }

    return await this.prisma.customLeagueMatch
      .update({
        where: {
          id,
        },
        data: {
          winnerId: winnerId,
        },
      })
      .catch((err) => {
        console.log(err);
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2023') {
            throw new NotFoundException(`League Match with id ${id} not found`);
          }
        }
      });
  }

  async findAll() {}

  async findOne(id: string) {
    return await this.prisma.customLeagueMatch.findUnique({
      where: {
        id,
      },
    });
  }

  async update(id: string, updateLeagueMatchDto: UpdateCustomLeagueMatchDto) {}

  async remove(id: string) {}
}
