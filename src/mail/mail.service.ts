import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Resend } from 'resend';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RESEND_CLIENT } from './mail.constants';

interface NewQuestionnaireNotificationData {
  userName: string;
  userEmail: string;
  userPhone: string;
  companyName: string;
  questionnaireId: string;
  userId: string;
}

function formatAmount(amount: number): string {
  return `${amount.toLocaleString('ru-RU')} ₽`;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly defaultFrom: string;

  constructor(
    @Inject(RESEND_CLIENT) private readonly resend: Resend,
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    this.defaultFrom = this.configService.get<string>(
      'MAIL_FROM',
      'AltaSales <onboarding@resend.dev>',
    );
  }

  async notifyAdminsAboutNewQuestionnaire(
    data: NewQuestionnaireNotificationData,
  ): Promise<void> {
    const admins = await this.userRepository.find({
      where: { role: UserRole.ADMIN },
      select: ['email', 'name'],
    });

    if (admins.length === 0) {
      this.logger.warn('No admins found to notify about new questionnaire');
      return;
    }

    const clientUrl = process.env.CLIENT_URI || 'http://localhost:3000';
    const questionnaireLink = `${clientUrl}/admin/clients/${data.userId}/questionnaire`;

    const subject = `Новая анкета: ${data.companyName}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #E75E32;">Новая анкета требует анализа</h2>

        <p>Пользователь заполнил анкету и ожидает формирования рекомендаций.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Компания:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${data.companyName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Имя:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.userName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Email:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.userEmail}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Телефон:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.userPhone}</td>
          </tr>
        </table>

        <p>
          <a href="${questionnaireLink}"
             style="display: inline-block; padding: 12px 24px; background-color: #E75E32; color: white; text-decoration: none; border-radius: 6px;">
            Открыть анкету
          </a>
        </p>

        <p style="color: #999; font-size: 12px; margin-top: 30px;">
          Это автоматическое уведомление от AltaSales
        </p>
      </div>
    `;

    const adminEmails = admins.map((admin) => admin.email);

    try {
      const { data: result, error } = await this.resend.emails.send({
        from: this.defaultFrom,
        to: adminEmails,
        subject,
        html,
      });

      if (error) {
        this.logger.error(
          `Failed to send notification email: ${error.message}`,
          error,
        );
        return;
      }

      this.logger.log(
        `Notification sent to ${adminEmails.length} admin(s) about questionnaire ${data.questionnaireId} (id: ${result?.id})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send notification email: ${error.message}`,
        error.stack,
      );
    }
  }

  async notifyAdminsAboutPaidOrder(data: {
    orderId: string;
    clientName: string;
    amount: number;
    items: Array<{ orderId: string; name: string; type: string; amount: number }>;
    adminOrdersUrl: string | null;
  }): Promise<void> {
    const admins = await this.userRepository.find({
      where: { role: UserRole.ADMIN },
      select: ['email'],
    });

    if (admins.length === 0) {
      this.logger.warn('No admins found to notify about paid order');
      return;
    }

    const adminEmails = admins.map((admin) => admin.email);
    const subject = `Новый заказ (${data.items.length} позиций, ${formatAmount(data.amount)})`;
    const linkBlock = data.adminOrdersUrl
      ? `<p>
           <a href="${data.adminOrdersUrl}"
              style="display: inline-block; padding: 12px 24px; ` +
        `background-color: #E75E32; color: white; text-decoration: none; ` +
        `border-radius: 6px;">
             Открыть страницу покупок
           </a>
         </p>`
      : '';
    const itemRows = data.items
      .map(
        (item) => `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.name}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">${item.type}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right; ` +
            `white-space: nowrap;">${formatAmount(item.amount)}</td>
          </tr>
        `,
      )
      .join('');
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #E75E32;">Новый оплаченный заказ</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Клиент:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.clientName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Позиций:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.items.length}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Итого:</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${formatAmount(data.amount)}</td>
          </tr>
        </table>
        <h3 style="color: #1A202C; margin: 20px 0 10px;">Состав заказа</h3>
        <table style="width: 100%; border-collapse: collapse; margin: 0 0 20px;">
          <thead>
            <tr style="background: #F9FAFB;">
              <th style="padding: 8px; text-align: left; color: #666; font-weight: 600;">Название</th>
              <th style="padding: 8px; text-align: left; color: #666; font-weight: 600;">Тип</th>
              <th style="padding: 8px; text-align: right; color: #666; font-weight: 600;">Цена</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>
        ${linkBlock}
        <p style="color: #999; font-size: 12px; margin-top: 30px;">
          Это автоматическое уведомление от AltaSales
        </p>
      </div>
    `;

    try {
      const { data: result, error } = await this.resend.emails.send({
        from: this.defaultFrom,
        to: adminEmails,
        subject,
        html,
      });

      if (error) {
        this.logger.error(
          `Failed to send paid-order email: ${error.message}`,
          error,
        );
        return;
      }

      this.logger.log(
        `Paid-order email sent to ${adminEmails.length} admin(s) for order ${data.orderId} (id: ${result?.id})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send paid-order email: ${error.message}`,
        error.stack,
      );
    }
  }

  async sendRecommendationsReadyEmail(
    userEmail: string,
    userName: string,
    recommendationsUrl: string,
  ): Promise<void> {
    const subject = 'Ваши рекомендации готовы';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #E75E32;">Рекомендации готовы</h2>
        <p>Здравствуйте, ${userName || 'пользователь'}!</p>
        <p>Для вас сформированы новые рекомендации. Перейдите по ссылке, чтобы посмотреть их.</p>
        <p>
          <a href="${recommendationsUrl}"
             style="display: inline-block; padding: 12px 24px; background-color: #E75E32; color: white; text-decoration: none; border-radius: 6px;">
            Открыть рекомендации
          </a>
        </p>
        <p style="color: #999; font-size: 12px; margin-top: 30px;">
          Это автоматическое уведомление от AltaSales
        </p>
      </div>
    `;

    try {
      const { data: result, error } = await this.resend.emails.send({
        from: this.defaultFrom,
        to: [userEmail],
        subject,
        html,
      });

      if (error) {
        this.logger.error(
          `Failed to send recommendations email to ${userEmail}: ${error.message}`,
          error,
        );
        return;
      }

      this.logger.log(
        `Recommendations email sent to ${userEmail} (id: ${result?.id})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send recommendations email to ${userEmail}: ${error.message}`,
        error.stack,
      );
    }
  }
}
