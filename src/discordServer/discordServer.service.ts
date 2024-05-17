import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDiscordServerDto } from './dto/create-discordServer.dto';
import { UpdateDiscordServerDto } from './dto/update-discordServer.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class DiscordServerService {
  constructor(private readonly prisma: PrismaService) {}

  async create(DiscordServerDto: CreateDiscordServerDto) {
    return await this.prisma.discordServer.create({
      data: DiscordServerDto,
    });
  }

  async findAll() {
    return this.prisma.discordServer.findMany();
  }

  async findByServerId(serverId: string) {
    const discordServer = await this.prisma.discordServer.findUnique({
      where: {
        discordServerId: serverId,
      },
    });
    if (discordServer) {
      return discordServer;
    }
    throw new NotFoundException(`Discord server with id ${serverId} not found`);
  }

  async update(
    serverId: string,
    UpdateDiscordServerDto: UpdateDiscordServerDto,
  ) {
    return await this.prisma.discordServer
      .update({
        where: {
          discordServerId: serverId,
        },
        data: UpdateDiscordServerDto,
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2025' || err.code === 'P2023') {
            throw new NotFoundException(
              `Discord server with id ${serverId} not found`,
            );
          }
        }
      });
  }

  async remove(serverId: string) {
    return await this.prisma.discordServer
      .delete({
        where: {
          discordServerId: serverId,
        },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2025' || err.code === 'P2023') {
            throw new NotFoundException(
              `Discord server with id ${serverId} not found`,
            );
          }
        }
      });
  }
}
