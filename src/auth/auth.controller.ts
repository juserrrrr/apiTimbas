import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
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

  @Post('refresh')
  async refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refresh(body.refreshToken);
  }

  // ─── Discord OAuth ────────────────────────────────────────────────────────

  @Get('discord')
  discordAuth(@Query('redirect') redirect: string, @Res() res: Response) {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);

    // Generate CSRF state token
    const state = randomBytes(32).toString('hex');

    // Store state in secure httpOnly cookie
    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: process.env.ENV_TYPE === 'PRODUCTION',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000, // 10 minutes
    });

    // Store original redirect URL in session (not in OAuth state)
    if (redirect) {
      res.cookie('oauth_redirect', encodeURIComponent(redirect), {
        httpOnly: true,
        secure: process.env.ENV_TYPE === 'PRODUCTION',
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
      });
    }

    const url = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify&state=${state}`;
    res.redirect(url);
  }

  @Get('discord/callback')
  async discordCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
    @Request() req,
  ) {
    const webUrl = process.env.WEB_URL;
    try {
      // Validate CSRF state token
      const storedState = req.cookies?.oauth_state;
      if (!state || state !== storedState) {
        Logger.error(`[Discord OAuth] CSRF falhou. Recebido: ${state}, Cookie: ${storedState}`, 'AuthController');
        throw new Error('CSRF state validation failed');
      }

      const { acessToken, refreshToken } = await this.authService.discordLogin(code);

      // Set tokens in secure httpOnly cookies instead of URL
      res.cookie('acessToken', acessToken, {
        httpOnly: true,
        secure: process.env.ENV_TYPE === 'PRODUCTION',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.ENV_TYPE === 'PRODUCTION',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      // Clear state and redirect cookies
      res.clearCookie('oauth_state');
      const originalRedirect = req.cookies?.oauth_redirect ? decodeURIComponent(req.cookies.oauth_redirect) : null;
      res.clearCookie('oauth_redirect');

      // Redirect to auth success page without tokens in URL
      let redirectUrl = `${webUrl}/auth/callback`;
      if (originalRedirect) {
        redirectUrl += `?redirect=${encodeURIComponent(originalRedirect)}`;
      }
      res.redirect(redirectUrl);
    } catch (e) {
      Logger.error('[Discord OAuth] discordCallback error:', e.stack, 'AuthController');
      if (e.response) {
        Logger.error(`Discord API Error Data: ${JSON.stringify(e.response.data)}`, 'AuthController');
      } else {
        Logger.error(`Error Message: ${e.message}`, 'AuthController');
      }
      res.redirect(`${webUrl}/login?error=auth_failed`);
    }
  }
}
