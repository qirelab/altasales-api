import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';

function parseCookies(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of raw.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 1) continue;
    const key = pair.substring(0, idx).trim();
    const val = decodeURIComponent(pair.substring(idx + 1).trim());
    result[key] = val;
  }
  return result;
}

@WebSocketGateway({
  cors: {
    origin: process.env.CLIENT_URI?.split(','),
    credentials: true,
  },
  path: '/ws',
  namespace: '/',
})
export class WebSocketGatewayService
implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(private readonly authService: AuthService) {}

  @WebSocketServer()
  server!: Server;

  async handleConnection(client: Socket) {
    try {
      const rawCookie = client.handshake.headers.cookie;
      if (!rawCookie) {
        client.disconnect();
        return;
      }

      const cookies = parseCookies(rawCookie);
      const sessionCookie = cookies.session;
      if (!sessionCookie) {
        client.disconnect();
        return;
      }

      const user = await this.authService.verifySessionCookie(sessionCookie);
      client.data.userId = user.id;
      client.join(`user:${user.id}`);
    } catch {
      client.disconnect();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by interface
  handleDisconnect(client: Socket) {
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() room: string,
  ) {
    if (room) client.join(room);
  }

  @SubscribeMessage('leave_room')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() room: string,
  ) {
    if (room) client.leave(room);
  }

  @SubscribeMessage('chat:typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; recipientId: string },
  ) {
    if (data?.recipientId && data?.conversationId) {
      this.emitToUser(data.recipientId, 'chat:typing', {
        conversationId: data.conversationId,
        userId: client.data.userId,
      });
    }
  }

  emitToRoom(room: string, event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.emitToRoom(`user:${userId}`, event, payload);
  }
}
