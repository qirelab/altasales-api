import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
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
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Validate BEFORE flushing SSE headers. Once the SSE body has started
    // Nest can no longer produce a real 404/403/400 response, so any auth
    // failure here has to come out as HTTP 200 + `event: error`, which the
    // client cannot distinguish from generation failures via HTTP status.
    // Nest serialises any exception thrown here as a normal error response.
    const context = await this.chatStreamingService.validate(user.id, id, dto);

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Cancel the upstream LLM request when the client disconnects — without
    // this the fetch keeps draining tokens from the provider even though no
    // one is reading the deltas.
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    req.on('close', abort);
    req.on('aborted', abort);

    const writeEvent = (payload: Record<string, unknown>, event?: string) => {
      if (res.writableEnded) return;
      if (event) res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      await this.chatStreamingService.runStream(
        context,
        {
          onClientMessage: () => {
            // No client-facing event — the SSE stream carries only the AI
            // reply. The persisted client message is delivered to the
            // sender's other sockets (if any) via the standard
            // `chat:new_message` WS event.
          },
          onDelta: (content) => writeEvent({ delta: content }),
          onDone: (aiMessage) =>
            writeEvent({ done: true, messageId: aiMessage.id }),
          onRefusal: (aiMessage, reason) =>
            writeEvent({
              refusal: true,
              messageId: aiMessage.id,
              reason,
            }),
          onError: (reason) => writeEvent({ reason }, 'error'),
        },
        abortController.signal,
      );
    } finally {
      req.off('close', abort);
      req.off('aborted', abort);
      if (!res.writableEnded) res.end();
    }
  }
}
