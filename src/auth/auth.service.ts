import {
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBotDto } from './dto/create-bot.dto';
import { Role } from '../enums/role.enum';
import { UserStatus } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
  ) {}

  createToken(
    id: string,
    name: string,
    email: string,
    role: string,
    discordId?: string,
    avatar?: string,
  ) {
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

  async createImpersonationToken(adminId: number, targetUserId: number) {
    const [admin, target] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: adminId } }),
      this.prisma.user.findUnique({ where: { id: targetUserId } }),
    ]);
    if (!admin || admin.role !== Role.ADMIN)
      throw new ForbiddenException(
        'Apenas administradores podem entrar como usuário.',
      );
    if (!target) throw new UnauthorizedException('Usuário não encontrado.');
    if (target.status !== UserStatus.APPROVED)
      throw new ForbiddenException(
        'Só é possível entrar como usuário aprovado.',
      );
    if (
      target.id === admin.id ||
      target.role === Role.ADMIN ||
      target.role === Role.BOT
    ) {
      throw new ForbiddenException(
        'Não é permitido entrar como administrador ou bot.',
      );
    }
    const token = this.jwtService.sign(
      {
        id: String(target.id),
        name: target.name,
        email: target.email ?? '',
        role: target.role,
        ...(target.discordId && { discordId: target.discordId }),
        ...(target.avatar && { avatar: target.avatar }),
        impersonatedBy: admin.id,
        impersonatorName: admin.name,
      },
      {
        expiresIn: '30m',
        subject: String(target.id),
        issuer: 'ApiTimbasSignature',
      },
    );
    this.logger.warn(
      `Admin ${admin.id} started impersonating user ${target.id} for up to 30 minutes`,
    );
    return {
      token,
      user: { id: target.id, name: target.name },
      expiresInSeconds: 1800,
    };
  }

  async refresh(refreshToken?: string) {
    if (!refreshToken)
      throw new UnauthorizedException('Refresh token not found');
    try {
      const decoded = this.jwtService.verify(refreshToken, {
        issuer: 'ApiTimbasRefresh',
      });

      const user = await this.prisma.user.findUnique({
        where: { id: Number(decoded.sub) },
      });

      if (!user) throw new UnauthorizedException('User not found');
      this.assertCanEnter(user.status, user.statusNote);

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

  async validateSessionToken(token: string) {
    const decoded = this.validateToken(token);
    if (decoded.role === Role.BOT && decoded.sub === 'bot' && !decoded.botId)
      return decoded;

    const user = decoded.botId
      ? await this.prisma.user.findUnique({
          where: { discordId: decoded.botId },
        })
      : await this.prisma.user.findUnique({
          where: { id: Number(decoded.sub) },
        });
    if (!user) throw new UnauthorizedException('User not found');
    this.assertCanEnter(user.status, user.statusNote);
    if (
      decoded.botId &&
      (user.role !== Role.BOT || user.discordId !== decoded.botId)
    ) {
      throw new UnauthorizedException('Bot session is no longer valid');
    }
    if (decoded.impersonatedBy) {
      const impersonator = await this.prisma.user.findUnique({
        where: { id: Number(decoded.impersonatedBy) },
      });
      if (!impersonator || impersonator.role !== Role.ADMIN) {
        throw new UnauthorizedException(
          'Impersonation session is no longer valid',
        );
      }
      this.assertCanEnter(impersonator.status, impersonator.statusNote);
    }
    return {
      ...decoded,
      id: String(user.id),
      sub: String(user.id),
      name: user.name,
      email: user.email ?? '',
      role: user.role,
      discordId: user.discordId,
      avatar: user.avatar ?? undefined,
    };
  }

  async login(emailLogin: string, password: string, lastLoginIp?: string) {
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
    this.assertCanEnter(user.status, user.statusNote);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        ...(lastLoginIp && { lastLoginIp }),
      },
    });

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

  async discordLogin(code: string, lastLoginIp?: string) {
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
      // Com aprovação ligada, quem chega fica na fila em vez de entrar direto.
      const settings = await this.prisma.platformSettings.findUnique({
        where: { id: 1 },
      });
      user = await this.prisma.user.create({
        data: {
          discordId: discordUser.id,
          name: discordUser.username,
          role: Role.PLAYER,
          status: settings?.requireApproval
            ? UserStatus.PENDING
            : UserStatus.APPROVED,
          avatar: incomingAvatar,
          lastLoginAt: new Date(),
          ...(lastLoginIp && { lastLoginIp }),
        },
      });
    } else {
      const updateData = {
        ...(user.name !== discordUser.username && {
          name: discordUser.username,
        }),
        ...(user.avatar !== incomingAvatar && { avatar: incomingAvatar }),
        lastLoginAt: new Date(),
        ...(lastLoginIp && { lastLoginIp }),
      };

      if (Object.keys(updateData).length > 0) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });
      }
    }

    this.assertCanEnter(user.status, user.statusNote);

    return this.createToken(
      user.id.toString(),
      user.name,
      user.email ?? '',
      user.role,
      user.discordId,
      user.avatar ?? undefined,
    );
  }

  /// A porta é a mesma para todo mundo: quem está na fila ou bloqueado não recebe
  /// token, e a mensagem diz o porquê.
  private assertCanEnter(status: UserStatus, note: string | null) {
    if (status === UserStatus.APPROVED) return;
    if (status === UserStatus.BLOCKED) {
      throw new ForbiddenException(
        note ?? 'Seu acesso foi bloqueado pela organização do Timbas.',
      );
    }
    throw new ForbiddenException(
      note ??
        'Sua entrada está aguardando aprovação da organização do Timbas. Chame alguém no Discord.',
    );
  }

  async authenticateBot(botId: string) {
    const bot = await this.prisma.user.findUnique({
      where: {
        discordId: botId,
        role: Role.BOT,
      },
    });

    if (!bot || bot.status !== UserStatus.APPROVED) {
      throw new UnauthorizedException('Bot not found');
    }

    return this.createBotToken(botId);
  }

  authenticateBotBySecret(secret: string) {
    const expectedSecret = process.env.BOT_SECRET;
    if (
      !expectedSecret ||
      secret.length !== expectedSecret.length ||
      !timingSafeEqual(Buffer.from(secret), Buffer.from(expectedSecret))
    ) {
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
