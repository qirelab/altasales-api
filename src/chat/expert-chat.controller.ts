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
import { ExpertChatService } from './services/expert-chat.service';
import type { ExpertSessionFilter } from './services/expert-chat.service';

@ApiTags('chat-expert')
@ApiCookieAuth('session')
@UseGuards(SessionGuard, RolesGuard)
@Roles(UserRole.EXPERT)
@Controller('chat/expert')
export class ExpertChatController {
  constructor(private readonly expertChatService: ExpertChatService) {}

  @Get('sessions')
  @ApiOperation({
    summary: 'List expert service chat sessions for the expert inbox',
    description:
      'Returns expert-type chat sessions where the current user is the ' +
      'expert participant, filtered by handoff status. `active` covers ' +
      'awaiting + in_progress. `resolved` covers closed handoffs. Never ' +
      'includes platform/operator sessions.',
  })
  @ApiQuery({
    name: 'filter',
    enum: ['all', 'active', 'resolved'],
    required: false,
  })
  listSessions(
    @CurrentUser() user: CurrentUserData,
    @Query(
      'filter',
      new DefaultValuePipe('all'),
      new ParseEnumPipe(['all', 'active', 'resolved']),
    )
    filter: ExpertSessionFilter,
  ) {
    return this.expertChatService.listExpertSessions(user.id, filter);
  }

  @Post('sessions/:id/claim')
  @UseGuards(ChatThrottlerGuard)
  @Throttle({ chat: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Claim an expert session for the current expert',
    description:
      'Sets handoffStatus to in_progress for a session the expert already ' +
      'belongs to. Race-safe conditional UPDATE.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 409, description: 'Claimed by another expert.' })
  claim(
    @Param('id', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.expertChatService.claim(user.id, sessionId);
  }

  @Post('sessions/:id/resolve')
  @UseGuards(ChatThrottlerGuard)
  @Throttle({ chat: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark an expert session handoff as resolved',
    description:
      'Only the assigned expert can resolve. Clears handoff flags so AI ' +
      'can resume (unless the linked order is completed).',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Assigned to another expert.' })
  resolve(
    @Param('id', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.expertChatService.resolve(user.id, sessionId);
  }
}
