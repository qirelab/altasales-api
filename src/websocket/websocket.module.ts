import { Module, Global } from '@nestjs/common';
import { WebSocketGatewayService } from './websocket.gateway.js';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [AuthModule],
  providers: [WebSocketGatewayService],
  exports: [WebSocketGatewayService],
})
export class WebSocketModule { }
