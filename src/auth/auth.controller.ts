import { Controller, Post, Body, Get, Param, Headers, Res, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { FirebaseService } from './firebase/firebase.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyTokenDto } from './dto/verify-token.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly firebaseService: FirebaseService,
  ) { }

  @Post('login')
  @ApiOperation({ summary: 'Login and set session cookie' })
  @ApiHeader({ name: 'authorization', description: 'Bearer token', required: true })
  @ApiResponse({
    status: 200,
    description: 'Successful login, sets session cookie',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid token',
  })
  async login(
    @Headers('authorization') authorization: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      if (!authorization || !authorization.startsWith('Bearer ')) {
        return {
          status: HttpStatus.UNAUTHORIZED,
          body: {
            message: 'Authorization header is required',
          },
        };
      }

      const accessToken = authorization.replace('Bearer ', '');

      const userInfo = await this.authService.verifyAndUpsertUser(accessToken);
      const { sessionCookie, expiresIn } = await this.authService.createSessionCookie(accessToken);

      const auth = this.firebaseService.getAuth();
      const { emailVerified } = await auth.getUser(userInfo.uid);

      res.cookie('session', sessionCookie, {
        maxAge: expiresIn,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined,
      });

      return {
        status: HttpStatus.OK,
        body: {
          ...userInfo,
          emailVerified,
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(error);
        return {
          status: HttpStatus.UNAUTHORIZED,
          body: {
            message: "You're not authorized to access this resource",
          },
        };
      }
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        body: {
          message: error.message || 'Internal server error',
        },
      };
    }
  }

  @Post('verify-token')
  @ApiOperation({ summary: 'Верификация Firebase ID токена' })
  @ApiResponse({ status: 200, description: 'Токен валиден' })
  @ApiResponse({ status: 401, description: 'Недействительный токен' })
  async verifyToken(@Body() verifyTokenDto: VerifyTokenDto) {
    return this.authService.verifyToken(verifyTokenDto);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Восстановление пароля' })
  @ApiResponse({ status: 200, description: 'Ссылка для восстановления пароля отправлена' })
  @ApiResponse({ status: 400, description: 'Пользователь не найден' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Get('user/:uid')
  @ApiOperation({ summary: 'Получить информацию о пользователе по UID' })
  @ApiResponse({ status: 200, description: 'Информация о пользователе' })
  @ApiResponse({ status: 400, description: 'Пользователь не найден' })
  async getUserByUid(@Param('uid') uid: string) {
    return this.authService.getUserByUid(uid);
  }
}
