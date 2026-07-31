import { OrderStatus } from '../../orders/entities/order-status.enum';
import { ClientContextService } from './client-context.service';

function buildService(overrides: {
  anket?: unknown;
  orders?: unknown[];
} = {}) {
  const questionnaireRepository = {
    findOne: jest.fn().mockResolvedValue(overrides.anket ?? null),
  };
  const orderRepository = {
    find: jest.fn().mockResolvedValue(overrides.orders ?? []),
  };
  const service = new ClientContextService(
    questionnaireRepository as never,
    orderRepository as never,
  );
  return { service, questionnaireRepository, orderRepository };
}

describe('ClientContextService.buildContextBlock', () => {
  it('returns empty string when no userId is provided', async () => {
    const { service, questionnaireRepository, orderRepository } = buildService();
    const block = await service.buildContextBlock('');
    expect(block).toBe('');
    expect(questionnaireRepository.findOne).not.toHaveBeenCalled();
    expect(orderRepository.find).not.toHaveBeenCalled();
  });

  it('marks anket as missing when the client has not filled it in', async () => {
    const { service } = buildService({ anket: null, orders: [] });
    const block = await service.buildContextBlock('client-1');
    expect(block).toContain('Анкета:');
    expect(block).toContain('не заполнена');
  });

  it('reports empty purchases when the client has no orders', async () => {
    const { service } = buildService({ anket: null, orders: [] });
    const block = await service.buildContextBlock('client-1');
    expect(block).toContain('Купленные услуги');
    expect(block).toContain('пока нет покупок');
  });

  it('renders anket fields (company/industry/goal/revenue/components)', async () => {
    const anket = {
      answers: {
        companyName: 'Acme Ltd',
        industry: 'IT-услуги',
        product: 'SaaS для склада',
        salesDirection: ['B2B'],
        leadGenerationTypes: ['inbound', 'outbound'],
        productStage: 'existing',
        desiredResult: { period: '3m', description: 'вырасти в 2 раза' },
        targetRevenue: 5_000_000,
        averageCheck: 100_000,
        conversionRate: 12,
        components: { crm: true, telephony: true, salesHead: false } as never,
        componentsToAdd: { analytics: true, scripts: true } as never,
      },
    };
    const { service } = buildService({ anket, orders: [] });
    const block = await service.buildContextBlock('client-1');
    expect(block).toContain('Компания: Acme Ltd');
    expect(block).toContain('Сфера: IT-услуги');
    expect(block).toContain('Продукт: SaaS для склада');
    expect(block).toContain('Модель продаж: B2B');
    expect(block).toContain('Лидогенерация: inbound, outbound');
    expect(block).toContain('Стадия продукта: существующий');
    expect(block).toContain('Цель на 3 месяца: вырасти в 2 раза');
    // toLocaleString('ru-RU') uses NBSP ( ) as thousand separator.
    expect(block).toContain(`Целевая выручка: ${(5_000_000).toLocaleString('ru-RU')}`);
    expect(block).toContain(`Средний чек: ${(100_000).toLocaleString('ru-RU')}`);
    expect(block).toContain('Конверсия: 12%');
    expect(block).toContain('Уже есть в отделе: CRM, телефония');
    expect(block).toContain('Хочет добавить: аналитика, скрипты');
  });

  it('renders each order with status label and offering name', async () => {
    const orders = [
      {
        status: OrderStatus.InProgress,
        item: { service: { name: 'Аудит отдела продаж' }, package: null },
      },
      {
        status: OrderStatus.Completed,
        item: { service: null, package: { name: 'CRM Серебро' } },
      },
      {
        status: OrderStatus.Cancelled,
        item: { service: { name: 'Обучение менеджеров' }, package: null },
      },
    ];
    const { service } = buildService({ anket: null, orders });
    const block = await service.buildContextBlock('client-1');
    expect(block).toContain('Услуга «Аудит отдела продаж» — в работе');
    expect(block).toContain('Пакет «CRM Серебро» — выполнен');
    expect(block).toContain('Услуга «Обучение менеджеров» — отменён');
  });

  it('returns empty string on repository failure (log-only, no throw)', async () => {
    const questionnaireRepository = {
      findOne: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const orderRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    const service = new ClientContextService(
      questionnaireRepository as never,
      orderRepository as never,
    );
    await expect(service.buildContextBlock('client-1')).resolves.toBe('');
  });
});
