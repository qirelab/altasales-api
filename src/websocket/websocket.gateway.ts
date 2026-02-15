import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

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
  @WebSocketServer()
  server!: Server;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by interface
  handleConnection(client: { id: string }) {
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by interface
  handleDisconnect(client: { id: string }) {
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(
    client: { id: string; join: (room: string) => void },
    @MessageBody() room: string,
  ) {
    if (room) client.join(room);
  }

  @SubscribeMessage('leave_room')
  handleLeaveRoom(
    client: { id: string; leave: (room: string) => void },
    @MessageBody() room: string,
  ) {
    if (room) client.leave(room);
  }

  emitToRoom(room: string, event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.emitToRoom(`user:${userId}`, event, payload);
  }
}
