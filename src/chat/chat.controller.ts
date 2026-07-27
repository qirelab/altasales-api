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
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
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

@ApiTags('chat')
@ApiCookieAuth('session')
@UseGuards(SessionGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

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
    summary:
      'Open or return the client\'s single platform chat with AI-консультант AltaSales',
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
}
