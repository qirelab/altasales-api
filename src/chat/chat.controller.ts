import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { SessionGuard } from '../auth/guards/session.guard';
import {
  CurrentUser,
  type CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { GetConversationsQueryDto } from './dto/get-conversations-query.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { StartConversationDto } from './dto/start-conversation.dto';
import { SendPlatformMessageDto } from './dto/send-platform-message.dto';
import { ChatStreamingService } from './services/chat-streaming.service';

@ApiTags('chat')
@ApiCookieAuth('session')
@UseGuards(SessionGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatStreamingService: ChatStreamingService,
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: 'Get conversations list' })
  getConversations(
    @CurrentUser() user: CurrentUserData,
    @Query() query: GetConversationsQueryDto,
  ) {
    return this.chatService.getConversations(user.id, query);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get messages for a conversation' })
  getMessages(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GetMessagesQueryDto,
  ) {
    return this.chatService.getMessages(user.id, id, query);
  }

  @Post('messages')
  @ApiOperation({ summary: 'Send a message (legacy expert-chat flow)' })
  sendMessage(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(user.id, dto);
  }

  @Patch('conversations/:id/read')
  @ApiOperation({ summary: 'Mark conversation as read' })
  markAsRead(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.markAsRead(user.id, id);
  }

  @Post('conversations/start')
  @ApiOperation({ summary: 'Find or create a conversation with a user' })
  startConversation(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: StartConversationDto,
  ) {
    return this.chatService.findOrCreateConversation(user.id, dto);
  }

  @Post('conversations/platform')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: `Open or return the client's single platform chat with AI-консультант AltaSales`,
  })
  openPlatformConversation(@CurrentUser() user: CurrentUserData) {
    return this.chatService.openPlatformConversation(user.id);
  }

  @Post('conversations/:id/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send a message inside a platform conversation. Client messages trigger ' +
      'an async AI reply (delivered via chat:new_message WS event).',
  })
  sendPlatformMessage(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendPlatformMessageDto,
  ) {
    return this.chatService.sendPlatformMessage(user.id, id, dto);
  }

  @Post('conversations/:id/messages/stream')
  @ApiOperation({
    summary:
      'Send a client message and stream the AI reply as Server-Sent Events. ' +
      'The client message is also persisted and broadcast on chat:new_message. ' +
      'Emits `data: {"delta":"..."}` chunks, then a terminal ' +
      '`data: {"done":true, "messageId":"..."}` or ' +
      '`data: {"refusal":true, "messageId":"...", "reason":"..."}`. ' +
      'On unexpected failure: `event: error\\ndata: {"reason":"..."}`.',
  })
  async streamPlatformMessage(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendPlatformMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const writeEvent = (payload: Record<string, unknown>, event?: string) => {
      if (res.writableEnded) return;
      if (event) res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    let hasSentTerminal = false;
    const markTerminal = () => {
      hasSentTerminal = true;
    };

    try {
      await this.chatStreamingService.streamPlatformMessage(user.id, id, dto, {
        onClientMessage: () => {
          // No client-facing event — the SSE stream carries only the AI reply.
          // The persisted client message is delivered to the sender's other
          // sockets (if any) via the standard `chat:new_message` WS event.
        },
        onDelta: (content) => writeEvent({ delta: content }),
        onDone: (aiMessage) => {
          markTerminal();
          writeEvent({ done: true, messageId: aiMessage.id });
        },
        onRefusal: (aiMessage, reason) => {
          markTerminal();
          writeEvent({
            refusal: true,
            messageId: aiMessage.id,
            reason,
          });
        },
        onError: (reason) => {
          markTerminal();
          writeEvent({ reason }, 'error');
        },
      });
    } catch (error) {
      if (!hasSentTerminal) {
        const reason =
          error instanceof HttpException
            ? this.pickReason(error)
            : 'stream_failed';
        writeEvent({ reason }, 'error');
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  private pickReason(error: HttpException): string {
    // Map known guard rejections to stable machine-readable strings so the
    // frontend can distinguish permission errors from generation failures
    // without depending on translated messages.
    const status = error.getStatus();
    if (status === HttpStatus.NOT_FOUND) return 'conversation_not_found';
    if (status === HttpStatus.FORBIDDEN) return 'not_a_participant';
    if (status === HttpStatus.BAD_REQUEST) return 'bad_request';
    return 'stream_failed';
  }
}
