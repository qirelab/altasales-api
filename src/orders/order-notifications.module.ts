import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatModule } from '../chat/chat.module';
import { MailModule } from '../mail/mail.module';
import { User } from '../users/entities/user.entity';
import { Order } from './entities/order.entity';
import { OrderNotificationService } from './order-notification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, User]),
    MailModule,
    ConfigModule,
    ChatModule,
  ],
  providers: [OrderNotificationService],
  exports: [OrderNotificationService],
})
export class OrderNotificationsModule {}
