import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { ChatThrottlerGuard } from './guards/chat-throttler.guard';
import { AdminChatService } from './services/admin-chat.service';
import type { OperatorSessionFilter } from './services/admin-chat.service';

@ApiTags('chat-admin')
@ApiCookieAuth('session')
@UseGuards(SessionGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('chat/admin')
export class AdminChatController {
  constructor(private readonly adminChatService: AdminChatService) {}

  @Get('sessions')
  @ApiOperation({
    summary: 'List platform chat sessions for the operator inbox',
    description:
      'Returns platform-type chat sessions filtered by handoff status. ' +
      '`active` covers awaiting + in_progress (things the operator should ' +
      'work on). `resolved` covers already-closed handoffs.',
  })
  @ApiQuery({
    name: 'filter',
    enum: ['active', 'resolved'],
    required: false,
  })
  listSessions(
    @Query(
      'filter',
      new DefaultValuePipe('active'),
      new ParseEnumPipe(['active', 'resolved']),
    )
    filter: OperatorSessionFilter,
  ) {
    return this.adminChatService.listOperatorSessions(filter);
  }

  @Post('sessions/:id/claim')
  @UseGuards(ChatThrottlerGuard)
  @Throttle({ chat: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Claim a session for the current operator',
    description:
      'Adds the current admin user as a participant with the `operator` ' +
      'role, sets handoffStatus to in_progress, records the timestamp, ' +
      'and emits `chat:handoff_claimed` to the client and any other ' +
      'session participants. Race-safe: a conditional UPDATE guarantees ' +
      'only one operator can claim.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 409, description: 'Claimed by another operator.' })
  claim(
    @Param('id', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.adminChatService.claim(user.id, sessionId);
  }

  @Post('sessions/:id/resolve')
  @UseGuards(ChatThrottlerGuard)
  @Throttle({ chat: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a session as resolved',
    description:
      'Only the operator who claimed the session (or any admin, if the ' +
      'session was claimed by nobody) can resolve. Clears the handoff ' +
      'flags, posts an AI "back online" announcement into the transcript, ' +
      'records the timestamp, and emits `chat:handoff_resolved`.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Assigned to another operator.' })
  resolve(
    @Param('id', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.adminChatService.resolve(user.id, sessionId);
  }
}
