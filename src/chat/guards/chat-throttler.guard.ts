import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Throttles per authenticated userId (set by SessionGuard on request.user).
// Falls back to IP for unauthenticated requests, though chat endpoints are
// always guarded by SessionGuard so req.user is always populated.
@Injectable()
export class ChatThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = (req.user as { id?: string } | undefined);
    if (user?.id) return `user:${user.id}`;
    const ip = (req.ip as string | undefined) ?? 'unknown';
    return `ip:${ip}`;
  }
}
