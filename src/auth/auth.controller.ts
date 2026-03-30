import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthLoginDto } from './dto/auth-login.dto';
import { AuthRegisterDto } from './dto/auth-register.dto';
import { AuthForgotDto } from './dto/auth-forgot.dto';
import { AuthResetDto } from './dto/auth-reset.dto';
import { AuthGuard } from './guards/auth.guard';
import { Role } from '../enums/role.enum';
import { Roles } from '../decorators/roles.decorator';
import { CreateBotDto } from './dto/create-bot.dto';
import { AuthBotDto } from './dto/auth-bot.dto';
import { AuthBotSecretDto } from './dto/auth-bot-secret.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() { email, password }: AuthLoginDto) {
    return this.authService.login(email, password);
  }

  @Post('register')
  async register(@Body() authRegisterDto: AuthRegisterDto) {
    return this.authService.register(authRegisterDto);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() { email }: AuthForgotDto) {
    return this.authService.forgotPassword(email);
  }

  @UseGuards(AuthGuard)
  @Post('reset-password')
  async resetPassword(@Body() { password }: AuthResetDto, @Request() req) {
    return this.authService.resetPassword(password, Number(req.tokenPayload.sub));
  }

  @UseGuards(AuthGuard)
  @Post('validate-token')
  async validateToken(@Request() req) {
    return { message: 'token is valid', data: req.tokenPayload };
  }

  @UseGuards(AuthGuard)
  @Roles(Role.ADMIN)
  @Post('create-bot')
  async createBot(@Body() createBotDto: CreateBotDto) {
    return this.authService.createBot(createBotDto);
  }

  @UseGuards(AuthGuard)
  @Roles(Role.ADMIN)
  @Post('authenticate-bot')
  async authenticateBot(@Body() { botId }: AuthBotDto) {
    return this.authService.authenticateBot(botId);
  }

  @Post('bot')
  async authenticateBotBySecret(@Body() { secret }: AuthBotSecretDto) {
    return this.authService.authenticateBotBySecret(secret);
  }

  // ─── Discord OAuth ────────────────────────────────────────────────────────

  @Get('discord')
  discordAuth(@Res() res: Response) {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
    const url = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;
    res.redirect(url);
  }

  @Get('discord/callback')
  async discordCallback(@Query('code') code: string, @Res() res: Response) {
    const webUrl = process.env.WEB_URL;
    try {
      const { acessToken } = await this.authService.discordLogin(code);
      res.redirect(`${webUrl}/auth/callback?token=${acessToken}`);
    } catch (e) {
      console.error('[Discord OAuth] discordLogin error:', e);
      res.redirect(`${webUrl}/login?error=auth_failed`);
    }
  }
}
