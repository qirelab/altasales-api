import { Controller, Post, Body, Get, Headers, Res, Req, HttpStatus, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiCookieAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { FirebaseService } from './firebase/firebase.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyTokenDto } from './dto/verify-token.dto';
import { SessionGuard } from './guards/session.guard';
import { CurrentUser, type CurrentUserData } from './decorators/current-user.decorator';

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
    @Req() req: Request,
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

      if (!emailVerified) {
        return {
          status: HttpStatus.FORBIDDEN,
          body: {
            message: 'Email not verified',
          },
        };
      }

      const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
      res.cookie('session', sessionCookie, {
        maxAge: expiresIn,
        httpOnly: true,
        secure: !isLocal,
        sameSite: isLocal ? 'lax' : 'none',
        domain: isLocal ? undefined : '.altasales.qirelab.com',
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
            message: 'You\'re not authorized to access this resource',
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

  // TODO: only for testing
  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  @ApiResponse({ status: 201, description: 'User successfully registered' })
  @ApiResponse({ status: 400, description: 'Registration error' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  // TODO: only for testing
  @Post('login-email')
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Successful login' })
  @ApiResponse({ status: 400, description: 'Invalid credentials' })
  async loginWithEmail(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('verify-token')
  @ApiOperation({ summary: 'Verify Firebase ID token' })
  @ApiResponse({ status: 200, description: 'Token is valid' })
  @ApiResponse({ status: 401, description: 'Invalid token' })
  async verifyToken(@Body() verifyTokenDto: VerifyTokenDto) {
    return this.authService.verifyToken(verifyTokenDto);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password' })
  @ApiResponse({ status: 200, description: 'Password reset link sent' })
  @ApiResponse({ status: 400, description: 'User not found' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }


  @Post('logout')
  @ApiOperation({ summary: 'Logout and clear session cookie' })
  @ApiResponse({ status: 200, description: 'Successfully logged out' })
  async logout(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    const sessionCookie = req.cookies?.session;
    if (sessionCookie) {
      try {
        await this.authService.revokeSessionCookie(sessionCookie);
      } catch {
        this.logger.warn('Failed to revoke session during logout');
      }
    }

    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';

    res.clearCookie('session', {
      httpOnly: true,
      secure: !isLocal,
      sameSite: isLocal ? 'lax' : 'none',
      domain: isLocal ? undefined : '.altasales.qirelab.com',
      path: '/',
    });

    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Get current user information (protected route)' })
  @ApiCookieAuth('session')
  @ApiResponse({ status: 200, description: 'Current user information' })
  @ApiResponse({ status: 401, description: 'Unauthorized - session cookie required' })
  async getCurrentUser(@CurrentUser() user: CurrentUserData) {
    return {
      id: user.id,
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      emailVerified: user.emailVerified,
      role: user.role,
    };
  }

}
