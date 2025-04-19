import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDiscordServerDto } from './dto/create-discordServer.dto';
import { UpdateDiscordServerDto } from './dto/update-discordServer.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class DiscordServerService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDiscordServerDto: CreateDiscordServerDto) {
    return this.prisma.discordServer
      .create({
        data: {
          discordServerId: createDiscordServerDto.discordServerId,
          doorMessages: {
            create: {
              channelId: null,
            },
          },
        },
        include: {
          doorMessages: true,
        },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') {
            throw new NotFoundException(
              `Discord server with id ${createDiscordServerDto.discordServerId} already exists`,
            );
          }
        }
        throw err;
      });
  }

  async findAll() {
    return this.prisma.discordServer.findMany({
      include: {
        doorMessages: true,
      },
    });
  }

  async findByServerId(serverId: number) {
    const discordServer = await this.prisma.discordServer.findUnique({
      where: {
        id: serverId,
      },
      include: {
        doorMessages: true,
      },
    });
    if (!discordServer) {
      throw new NotFoundException(
        `Discord server with id ${serverId} not found`,
      );
    }
    return discordServer;
  }

  async findWelcomeMsgByServerId(serverId: number) {
    const discordServer = await this.prisma.discordServer.findUnique({
      where: {
        id: serverId,
      },
      include: {
        doorMessages: {
          include: {
            welcomeMsg: true,
          },
        },
      },
    });
    if (!discordServer) {
      throw new NotFoundException(
        `Discord server with id ${serverId} not found`,
      );
    }
    return discordServer;
  }

  async findLeaveMsgByServerId(serverId: number) {
    const discordServer = await this.prisma.discordServer.findUnique({
      where: {
        id: serverId,
      },
      include: {
        doorMessages: {
          include: {
            goodbyeMsg: true,
          },
        },
      },
    });
    if (!discordServer) {
      throw new NotFoundException(
        `Discord server with id ${serverId} not found`,
      );
    }
    return discordServer;
  }

  async findBanMsgByServerId(serverId: number) {
    const discordServer = await this.prisma.discordServer.findUnique({
      where: {
        id: serverId,
      },
      include: {
        doorMessages: {
          include: {
            banMsg: true,
          },
        },
      },
    });
    if (!discordServer) {
      throw new NotFoundException(
        `Discord server with id ${serverId} not found`,
      );
    }
    return discordServer;
  }

  async update(
    serverId: number,
    updateDiscordServerDto: UpdateDiscordServerDto,
  ) {
    return this.prisma.discordServer
      .update({
        where: {
          id: serverId,
        },
        data: {
          discordServerId: updateDiscordServerDto.discordServerId,
          doorMessages: {
            update: {
              channelId: updateDiscordServerDto.channelId,
            },
          },
        },
        include: {
          doorMessages: true,
        },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2025') {
            throw new NotFoundException(
              `Discord server with id ${serverId} not found`,
            );
          }
        }
        throw err;
      });
  }

  async remove(serverId: number) {
    return this.prisma.discordServer
      .delete({
        where: {
          id: serverId,
        },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2025') {
            throw new NotFoundException(
              `Discord server with id ${serverId} not found`,
            );
          }
        }
        throw err;
      });
  }
}
