import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Resend } from 'resend';
import { User } from '../users/entities/user.entity';
import { MailService } from './mail.service';
import { RESEND_CLIENT } from './mail.constants';

@Module({
  imports: [TypeOrmModule.forFeature([User]), ConfigModule],
  providers: [
    {
      provide: RESEND_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const apiKey = configService.get<string>('RESEND_API_KEY');
        if (!apiKey) {
          throw new Error('RESEND_API_KEY is not defined');
        }
        return new Resend(apiKey);
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
