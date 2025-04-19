import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthRegisterDto } from './dto/auth-register.dto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { CreateBotDto } from './dto/create-bot.dto';
import { Role } from '../enums/role.enum';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
  ) {}

  createToken(id: string, name: string, email: string, role: string) {
    const acessToken = this.jwtService.sign(
      {
        id,
        name,
        email,
        role,
      },
      {
        expiresIn: '1h',
        subject: id,
        issuer: 'ApiTimbasSignature',
      },
    );
    return {
      acessToken,
    };
  }

  createBotToken(botId: string) {
    const acessToken = this.jwtService.sign(
      {
        botId,
      },
      {
        expiresIn: '1y',
        subject: botId,
        issuer: 'ApiTimbasSignature',
      },
    );
    return {
      acessToken,
    };
  }

  validateToken(token: string) {
    try {
      const decoded = this.jwtService.verify(token, {
        issuer: 'ApiTimbasSignature',
      });
      return decoded;
    } catch {
      throw new UnauthorizedException('Token invalid');
    }
  }

  async register(authRegisterDto: AuthRegisterDto) {
    const user = await this.userService.create(authRegisterDto);
    if (typeof user === 'object') {
      const { id, name, email, role } = user;
      return this.createToken(id.toString(), name, email, role);
    }
  }

  async login(emailLogin: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        email: emailLogin,
      },
    });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('email or password is incorrect');
    }
    const { id, name, email, role } = user;
    return this.createToken(id.toString(), name, email, role);
  }

  //Verficar se a token do user no point é valida, se for, criar token do bot e também colocar rule de admin
  async loginBot(botId: string) {
    return this.createBotToken(botId);
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (user) {
      // Enviar email com link ou token para resetar a senha
    }

    return {
      message:
        'if the email exists, an email will be sent to reset the password',
    };
  }

  async resetPassword(password: string, token: string) {
    // validate token
    const decoded = this.validateToken(token);
    await this.prisma.user.update({
      where: {
        id: Number(decoded.sub),
      },
      data: {
        password,
      },
    });
  }

  async createBot(createBotDto: CreateBotDto) {
    const bot = await this.prisma.user.create({
      data: {
        name: createBotDto.name,
        discordId: createBotDto.discordId,
        role: Role.BOT,
      },
      select: {
        id: true,
        name: true,
        discordId: true,
        role: true,
      },
    });

    return bot;
  }

  async authenticateBot(botId: string) {
    const bot = await this.prisma.user.findUnique({
      where: {
        discordId: botId,
        role: Role.BOT,
      },
    });

    if (!bot) {
      throw new UnauthorizedException('Bot not found');
    }

    return this.createBotToken(botId);
  }
}
