import { Module, Global } from '@nestjs/common';
import { WebSocketGatewayService } from './websocket.gateway.js';

@Global()
@Module({
  providers: [WebSocketGatewayService],
  exports: [WebSocketGatewayService],
})
export class WebSocketModule { }
