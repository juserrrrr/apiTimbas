import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthRegisterDto } from './dto/auth-register.dto';
import * as bcrypt from 'bcrypt';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
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
    private readonly httpService: HttpService,
  ) {}

  createToken(id: string, name: string, email: string, role: string, discordId?: string, avatar?: string) {
    const acessToken = this.jwtService.sign(
      {
        id,
        name,
        email,
        role,
        ...(discordId && { discordId }),
        ...(avatar && { avatar }),
      },
      {
        expiresIn: '7d',
        subject: id,
        issuer: 'ApiTimbasSignature',
      },
    );

    const refreshToken = this.jwtService.sign(
      { type: 'refresh' },
      {
        expiresIn: '30d',
        subject: id,
        issuer: 'ApiTimbasRefresh',
      },
    );

    return { acessToken, refreshToken };
  }

  async refresh(refreshToken: string) {
    try {
      const decoded = this.jwtService.verify(refreshToken, {
        issuer: 'ApiTimbasRefresh',
      });

      const user = await this.prisma.user.findUnique({
        where: { id: Number(decoded.sub) },
      });

      if (!user) throw new UnauthorizedException('User not found');

      return this.createToken(
        user.id.toString(),
        user.name,
        user.email ?? '',
        user.role,
        user.discordId,
        user.avatar ?? undefined,
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  createBotToken(botId: string) {
    const acessToken = this.jwtService.sign(
      {
        botId,
        role: Role.BOT,
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
    const user = await this.userService.createUser(authRegisterDto);
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
      throw new UnauthorizedException('Email or password is incorrect');
    }

    if (user.role !== Role.USER && user.role !== Role.ADMIN) {
      throw new UnauthorizedException('Only users and admins can login');
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

  async resetPassword(password: string, userId: number) {
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(password, salt);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { message: 'Password updated successfully' };
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

  async discordLogin(code: string) {
    // 1. Trocar code por access token do Discord
    const tokenRes = await firstValueFrom(
      this.httpService.post(
        'https://discord.com/api/oauth2/token',
        new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: process.env.DISCORD_REDIRECT_URI,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      ),
    );

    // 2. Buscar dados do usuário no Discord
    const userRes = await firstValueFrom(
      this.httpService.get('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
      }),
    );

    const discordUser = userRes.data;

    // 3. Buscar ou criar usuário pelo discordId
    let user = await this.prisma.user.findUnique({
      where: { discordId: discordUser.id },
    });

    const incomingAvatar: string | null = discordUser.avatar ?? null;

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          discordId: discordUser.id,
          name: discordUser.username,
          role: Role.PLAYER,
          avatar: incomingAvatar,
        },
      });
    } else if (user.avatar !== incomingAvatar) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { avatar: incomingAvatar },
      });
    }

    return this.createToken(
      user.id.toString(),
      user.name,
      user.email ?? '',
      user.role,
      user.discordId,
      user.avatar ?? undefined,
    );
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

  authenticateBotBySecret(secret: string) {
    const expectedSecret = process.env.BOT_SECRET;
    if (!expectedSecret || secret !== expectedSecret) {
      throw new ForbiddenException('Invalid bot secret');
    }

    const acessToken = this.jwtService.sign(
      { role: Role.BOT },
      {
        expiresIn: '24h',
        subject: 'bot',
        issuer: 'ApiTimbasSignature',
      },
    );

    return { acessToken };
  }
}
