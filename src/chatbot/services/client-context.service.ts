import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { OrderStatus } from '../../orders/entities/order-status.enum';
import { Order } from '../../orders/entities/order.entity';
import {
  Questionnaire,
  QuestionnaireComponents,
} from '../../questionnaires/entities/questionnaire.entity';
import { ServicePackage } from '../../packages/entities/package.entity';
import { Service } from '../../services/entities/service.entity';
import { ServiceType } from '../../services/entities/service-type.enum';

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

/** Keep the catalog block compact so it fits alongside anket + RAG. */
const CATALOG_SERVICE_LIMIT = 80;
const CATALOG_PACKAGE_LIMIT = 40;
const CATALOG_DESC_MAX = 120;

@Injectable()
export class ClientContextService {
  private readonly logger = new Logger(ClientContextService.name);

  constructor(
    @InjectRepository(Questionnaire)
    private readonly questionnaireRepository: Repository<Questionnaire>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(ServicePackage)
    private readonly packageRepository: Repository<ServicePackage>,
  ) {}

  // Builds a compact markdown block describing what we know about the client
  // (anket + purchases + visible catalog). Meant to be injected into the LLM
  // prompt so the bot references facts about THIS client and can name real
  // catalog services/packages without inventing them (QIR-720).
  async buildContextBlock(userId: string): Promise<string> {
    if (!userId) return '';
    try {
      const [anket, orders, catalogServices, catalogPackages] = await Promise.all([
        this.questionnaireRepository.findOne({ where: { userId } }),
        this.orderRepository.find({
          where: { userId },
          relations: ['item', 'item.service', 'item.package'],
          order: { createdAt: 'DESC' },
        }),
        this.loadCatalogServices(),
        this.loadCatalogPackages(),
      ]);
      const parts: string[] = ['## Данные клиента'];
      parts.push('', this.formatAnket(anket));
      parts.push('', this.formatOrders(orders));
      parts.push('', this.formatCatalog(catalogServices, catalogPackages));
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

  private async loadCatalogServices(): Promise<Service[]> {
    return this.serviceRepository.find({
      where: {
        type: In([ServiceType.Service, ServiceType.Document]),
        isHidden: false,
        deletedAt: IsNull(),
      },
      relations: ['category'],
      order: { name: 'ASC' },
      take: CATALOG_SERVICE_LIMIT,
    });
  }

  private async loadCatalogPackages(): Promise<ServicePackage[]> {
    return this.packageRepository.find({
      where: {
        isHidden: false,
        deletedAt: IsNull(),
      },
      relations: ['categories'],
      order: { name: 'ASC' },
      take: CATALOG_PACKAGE_LIMIT,
    });
  }

  private formatCatalog(
    services: Service[],
    packages: ServicePackage[],
  ): string {
    if (!services.length && !packages.length) {
      return '**Каталог услуг и пакетов:** сейчас недоступен.';
    }
    const lines: string[] = [
      '**Каталог AltaSales** (рекомендуй только из этого списка,',
      'и только если клиент ещё не купил позицию):',
    ];
    if (services.length) {
      lines.push('', '### Услуги');
      lines.push(...this.formatServicesByCategory(services));
    }
    if (packages.length) {
      lines.push('', '### Пакеты');
      lines.push(...this.formatPackagesByCategory(packages));
    }
    return lines.join('\n');
  }

  private formatServicesByCategory(services: Service[]): string[] {
    const byCategory = new Map<string, Service[]>();
    for (const service of services) {
      if (service.category?.isHidden) continue;
      const categoryName = service.category?.name?.trim() || 'Без категории';
      const bucket = byCategory.get(categoryName) ?? [];
      bucket.push(service);
      byCategory.set(categoryName, bucket);
    }
    const lines: string[] = [];
    const categories = [...byCategory.keys()].sort((a, b) =>
      a.localeCompare(b, 'ru'),
    );
    for (const category of categories) {
      lines.push(`#### ${category}`);
      for (const service of byCategory.get(category) ?? []) {
        lines.push(this.formatCatalogItem(service.name, service.description));
      }
    }
    return lines;
  }

  private formatPackagesByCategory(packages: ServicePackage[]): string[] {
    const byCategory = new Map<string, ServicePackage[]>();
    for (const pkg of packages) {
      const categories = pkg.categories ?? [];
      const visibleCategories = categories.filter((category) => !category.isHidden);
      // Skip packages that only belong to hidden categories (same as services).
      if (categories.length > 0 && visibleCategories.length === 0) continue;
      const categoryNames = visibleCategories.length
        ? visibleCategories.map((c) => c.name?.trim() || 'Без категории')
        : ['Без категории'];
      for (const categoryName of categoryNames) {
        const bucket = byCategory.get(categoryName) ?? [];
        bucket.push(pkg);
        byCategory.set(categoryName, bucket);
      }
    }
    const lines: string[] = [];
    const categories = [...byCategory.keys()].sort((a, b) =>
      a.localeCompare(b, 'ru'),
    );
    for (const category of categories) {
      lines.push(`#### ${category}`);
      for (const pkg of byCategory.get(category) ?? []) {
        lines.push(this.formatCatalogItem(pkg.name, pkg.description));
      }
    }
    return lines;
  }

  private formatCatalogItem(
    name: string,
    description: string | null | undefined,
  ): string {
    const desc = this.shortDescription(description);
    return desc ? `- **${name}** — ${desc}` : `- **${name}**`;
  }

  private shortDescription(raw: string | null | undefined): string {
    if (!raw) return '';
    const trimmed = raw.replace(/\s+/g, ' ').trim();
    if (trimmed.length <= CATALOG_DESC_MAX) return trimmed;
    return `${trimmed.slice(0, CATALOG_DESC_MAX - 1).trimEnd()}…`;
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
