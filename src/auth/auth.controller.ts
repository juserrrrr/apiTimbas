import {
  Body,
  Controller,
  Post,
  Headers,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthLoginDto } from './dto/auth-login.dto';
import { AuthRegisterDto } from './dto/auth-register.dto';
import { AuthForgotDto } from './dto/auth-forgot.dto';
import { AuthResetDto } from './dto/auth-reset.dto';
import { AuthGuard } from './guards/auth.guard';
import { Role } from '../enums/role.enum';
import { Roles } from '../decorators/roles.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() { email, password }: AuthLoginDto) {
    return this.authService.login(email, password);
  }

  @UseGuards(AuthGuard)
  @Roles(Role.ADMIN)
  @Post('login-bot')
  async loginBot(@Body() { botId }: { botId: string }) {
    return this.authService.loginBot(botId);
  }

  @Post('register')
  async register(@Body() authRegisterDto: AuthRegisterDto) {
    return this.authService.register(authRegisterDto);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() { email }: AuthForgotDto) {
    return this.authService.forgotPassword(email);
  }

  @Post('reset-password')
  async resetPassword(
    @Body() { password }: AuthResetDto,
    @Headers('authorization') token: string,
  ) {
    return this.authService.resetPassword(password, token);
  }

  @UseGuards(AuthGuard)
  @Post('validate-token')
  async validateToken(@Request() req) {
    return {
      message: 'token is valid',
      data: req.tokenPayload,
    };
  }
}
