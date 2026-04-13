import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../auth.service';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const sessionCookie = request.cookies?.session;

    if (!sessionCookie) {
      throw new UnauthorizedException('Session cookie not found');
    }

    try {
      const user = await this.authService.verifySessionCookie(sessionCookie);

      request.user = user;
      return true;
    } catch (error) {
      response.clearCookie('session', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined,
      });

      if (error.code === 'auth/id-token-expired') {
        throw new UnauthorizedException({
          message: 'Token expired. Please clear the session cookie and login again.',
          clearCookie: true,
        });
      }
      throw new UnauthorizedException({
        message: 'Invalid session cookie. Please clear the session cookie and login again.',
        clearCookie: true,
      });
    }
  }
}
