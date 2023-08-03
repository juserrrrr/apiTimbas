import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { isValidObjectId } from 'mongoose';
import { Prisma } from '@prisma/client';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    return this.prisma.user
      .create({
        data: createUserDto,
        select: { id: true },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') {
            throw new BadRequestException(
              `User with email ${createUserDto.email} already exists`,
            );
          }
        }
      });
  }

  async findAll() {
    return this.prisma.user.findMany();
  }

  async findOne(id: string) {
    if (isValidObjectId(id)) {
      const user = await this.prisma.user.findUnique({
        where: {
          id,
        },
      });
      if (user) {
        return user;
      }
    }
    throw new NotFoundException(`User with id ${id} not found`);
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    await this.findOne(id);
    return this.prisma.user
      .update({
        where: {
          id,
        },
        data: updateUserDto,
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2025') {
            throw new NotFoundException(`User with id ${id} not found`);
          }
        }
      });
  }

  async remove(id: string) {
    return this.prisma.user
      .delete({
        where: {
          id,
        },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2025') {
            throw new NotFoundException(`User with id ${id} not found`);
          }
        }
      });
  }
}
