import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { isValidObjectId } from 'mongoose';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    const salt = await bcrypt.genSalt();

    createUserDto.password = await bcrypt.hash(createUserDto.password, salt);

    const userCreated = await this.prisma.user
      .create({
        data: createUserDto,
        select: {
          id: true,
          email: true,
          discordId: true,
          name: true,
          role: true,
          TeamsLeague: true,
        },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          switch (err.code) {
            case 'P2002':
              throw new BadRequestException(
                `User with ${err.meta?.target} already exists`,
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
    return userCreated;
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        discordId: true,
        TeamsLeague: true,
      },
    });
  }

  async findOne(id: number) {
    if (isValidObjectId(id)) {
      const user = await this.prisma.user.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          discordId: true,
          TeamsLeague: true,
        },
      });
      if (user) {
        return user;
      }
    }
    throw new NotFoundException(`User with id ${id} not found`);
  }

  async findOneByDiscordId(discordId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        discordId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        discordId: true,
        TeamsLeague: true,
      },
    });
    if (user) {
      return user;
    }
    throw new NotFoundException(`User with discordId ${discordId} not found`);
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    if (updateUserDto.password) {
      const salt = await bcrypt.genSalt();
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, salt);
    }
    await this.findOne(id); // SEE CHANGING THIS LOGIC LATER
    return this.prisma.user
      .update({
        where: {
          id,
        },
        data: updateUserDto,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          discordId: true,
          TeamsLeague: true,
        },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2025' || err.code === 'P2023') {
            throw new NotFoundException(`User with id ${id} not found`);
          }
        }
      });
  }

  async remove(id: number) {
    return this.prisma.user
      .delete({
        where: {
          id,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          discordId: true,
          TeamsLeague: true,
        },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2025' || err.code === 'P2023') {
            throw new NotFoundException(`User with id ${id} not found`);
          }
        }
      });
  }
}
