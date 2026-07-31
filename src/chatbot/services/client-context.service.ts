import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderStatus } from '../../orders/entities/order-status.enum';
import { Order } from '../../orders/entities/order.entity';
import {
  Questionnaire,
  QuestionnaireComponents,
} from '../../questionnaires/entities/questionnaire.entity';

const STATUS_LABEL: Record<OrderStatus, string> = {
  [OrderStatus.PendingPayment]: 'ожидает оплаты',
  [OrderStatus.Planned]: 'запланирован',
  [OrderStatus.InProgress]: 'в работе',
  [OrderStatus.Completed]: 'выполнен',
  [OrderStatus.Cancelled]: 'отменён',
};

const COMPONENT_LABEL: Record<keyof QuestionnaireComponents, string> = {
  crm: 'CRM',
  telephony: 'телефония',
  messenger: 'мессенджер',
  voiceChatbot: 'голосовой чат-бот',
  contactDatabase: 'база контактов',
  salesManager: 'менеджер по продажам',
  trainingSystem: 'система обучения',
  analytics: 'аналитика',
  scripts: 'скрипты',
  callAnalysis: 'анализ звонков',
  salesDocuments: 'документы по продажам',
  salesHead: 'руководитель отдела продаж',
};

@Injectable()
export class ClientContextService {
  private readonly logger = new Logger(ClientContextService.name);

  constructor(
    @InjectRepository(Questionnaire)
    private readonly questionnaireRepository: Repository<Questionnaire>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  // Builds a compact markdown block describing what we know about the client
  // (anket + purchases). Meant to be injected into the LLM prompt so the
  // bot references facts about THIS client, not generic advice.
  async buildContextBlock(userId: string): Promise<string> {
    if (!userId) return '';
    try {
      const [anket, orders] = await Promise.all([
        this.questionnaireRepository.findOne({ where: { userId } }),
        this.orderRepository.find({
          where: { userId },
          relations: ['item', 'item.service', 'item.package'],
          order: { createdAt: 'DESC' },
        }),
      ]);
      const parts: string[] = ['## Данные клиента'];
      parts.push('', this.formatAnket(anket));
      parts.push('', this.formatOrders(orders));
      return parts.join('\n').trim();
    } catch (error) {
      this.logger.warn(
        `Failed to build client context for ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return '';
    }
  }

  private formatAnket(anket: Questionnaire | null): string {
    if (!anket) {
      return '**Анкета:** не заполнена. Клиент ещё не прошёл онбординг.';
    }
    const a = anket.answers;
    const lines: string[] = ['**Анкета клиента:**'];
    if (a.companyName) lines.push(`- Компания: ${a.companyName}`);
    if (a.industry) lines.push(`- Сфера: ${a.industry}`);
    if (a.product) lines.push(`- Продукт: ${a.product}`);
    if (a.website) lines.push(`- Сайт: ${a.website}`);
    if (a.salesDirection?.length) {
      lines.push(`- Модель продаж: ${a.salesDirection.join(', ')}`);
    }
    if (a.leadGenerationTypes?.length) {
      lines.push(`- Лидогенерация: ${a.leadGenerationTypes.join(', ')}`);
    }
    if (a.productStage) {
      lines.push(
        `- Стадия продукта: ${a.productStage === 'new' ? 'новый' : 'существующий'}`,
      );
    }
    if (a.desiredResult?.description) {
      const period =
        a.desiredResult.period === '1m' ? '1 месяц'
          : a.desiredResult.period === '3m' ? '3 месяца' : '6 месяцев';
      lines.push(
        `- Цель на ${period}: ${a.desiredResult.description}`,
      );
    }
    if (a.targetRevenue) {
      lines.push(`- Целевая выручка: ${a.targetRevenue.toLocaleString('ru-RU')} руб.`);
    }
    if (a.averageCheck) {
      lines.push(`- Средний чек: ${a.averageCheck.toLocaleString('ru-RU')} руб.`);
    }
    if (a.conversionRate != null) {
      lines.push(`- Конверсия: ${a.conversionRate}%`);
    }
    const existing = this.componentList(a.components);
    if (existing) lines.push(`- Уже есть в отделе: ${existing}`);
    const wanted = this.componentList(a.componentsToAdd);
    if (wanted) lines.push(`- Хочет добавить: ${wanted}`);
    return lines.join('\n');
  }

  private componentList(components?: QuestionnaireComponents): string {
    if (!components) return '';
    const present = (Object.keys(components) as (keyof QuestionnaireComponents)[])
      .filter((key) => components[key])
      .map((key) => COMPONENT_LABEL[key]);
    return present.join(', ');
  }

  private formatOrders(orders: Order[]): string {
    if (!orders?.length) {
      return '**Купленные услуги:** пока нет покупок на платформе.';
    }
    const lines: string[] = ['**Купленные услуги и пакеты:**'];
    for (const order of orders) {
      const title = this.orderTitle(order);
      const status = STATUS_LABEL[order.status] ?? order.status;
      lines.push(`- ${title} — ${status}`);
    }
    return lines.join('\n');
  }

  private orderTitle(order: Order): string {
    const item = order.item;
    if (!item) return 'Заказ без позиции';
    if (item.package) return `Пакет «${item.package.name}»`;
    if (item.service) return `Услуга «${item.service.name}»`;
    return 'Заказ без позиции';
  }
}
