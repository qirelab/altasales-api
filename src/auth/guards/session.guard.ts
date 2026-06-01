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
      const hostname = request.hostname;
      const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
      response.clearCookie('session', {
        httpOnly: true,
        secure: !isLocal,
        sameSite: isLocal ? 'lax' : 'none',
        domain: isLocal ? undefined : '.altasales.qirelab.com',
        path: '/',
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
