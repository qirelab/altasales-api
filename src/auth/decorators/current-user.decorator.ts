import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../../users/entities/user-role.enum';

export interface CurrentUserData {
  id: string;
  uid: string;
  email: string;
  displayName?: string;
  emailVerified: boolean;
  role: UserRole;
  notificationsSeenAt?: Date | null;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CurrentUserData => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
