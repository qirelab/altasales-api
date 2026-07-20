import { Module, Global } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebSocketGatewayService } from './websocket.gateway.js';

@Global()
@Module({
  imports: [AuthModule],
  providers: [WebSocketGatewayService],
  exports: [WebSocketGatewayService],
})
export class WebSocketModule { }
