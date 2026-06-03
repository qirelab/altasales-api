import { MigrationInterface, QueryRunner } from 'typeorm';
import { ServiceType } from '../services/entities/service-type.enum';

type SeedCategory = {
  name: string;
  slug: string;
  description: string;
};

type SeedService = {
  name: string;
  category: string;
  type: ServiceType;
  price: number;
  description: string;
  skills: string[];
};

const categories: SeedCategory[] = [
  {
    name: 'Пакет услуг',
    slug: 'service-packages',
    description: 'Комплексные пакеты услуг AltaSales',
  },
  {
    name: 'CRM система',
    slug: 'crm-system',
    description: 'CRM, интеграции, автоматизация и техническая настройка',
  },
  {
    name: 'Документы',
    slug: 'documents',
    description: 'Регламенты, инструкции, скрипты и управленческие документы',
  },
  {
    name: 'Подбор персонала',
    slug: 'recruitment',
    description: 'Подбор, скрининг и интервью менеджеров по продажам',
  },
  {
    name: 'Управление продажами',
    slug: 'sales-management',
    description: 'РОП, управление отделом продаж и стратегическая поддержка',
  },
  {
    name: 'Контроль качества',
    slug: 'quality-control',
    description: 'Анализ звонков, переписок и потерь сделок',
  },
  {
    name: 'Система обучения',
    slug: 'training-system',
    description: 'Обучение, адаптация, аттестация и развитие менеджеров',
  },
  {
    name: 'Эксперты',
    slug: 'experts',
    description: 'Экспертная поддержка собственника и управленческой команды',
  },
];

const services: SeedService[] = [
  {
    name: 'Пакет обучения на 3 месяца',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 0,
    description:
      'Оценка знаний, подготовка плана обучения на 3 месяца и серия онлайн-тренингов для менеджеров.',
    skills: ['обучение', 'тренинг', 'план обучения', 'менеджеры'],
  },
  {
    name: 'Пакет обучения на месяц',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 0,
    description:
      'Оценка знаний, подготовка месячного плана обучения и базовые онлайн-тренинги для менеджеров.',
    skills: ['обучение', 'тренинг', 'план обучения'],
  },
  {
    name: 'Отдел продаж с нуля',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 0,
    description:
      'Комплексный запуск отдела продаж: документы, мотивация, отчётность, подбор менеджеров и настройка CRM.',
    skills: ['отдел продаж с нуля', 'crm', 'документы', 'подбор', 'мотивация'],
  },
  {
    name: 'CRM Старт',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 20000,
    description:
      'Стартовый пакет CRM: интеграция телефонии, мессенджера и почтового сервиса.',
    skills: ['crm старт', 'телефония', 'мессенджер', 'почта', 'интеграция'],
  },
  {
    name: 'Пакет документов отдела продаж',
    category: 'Пакет услуг',
    type: ServiceType.Document,
    price: 25000,
    description:
      'Должностные инструкции, рабочие инструкции, регламенты, адаптационный план и регламент планёрок.',
    skills: ['пакет документов', 'отдел продаж', 'регламент', 'инструкция', 'адаптация'],
  },
  {
    name: 'Скрининг',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 27000,
    description:
      'Скрининг резюме кандидатов под требования вакансии: опыт, квалификация и знания.',
    skills: ['подбор', 'скрининг', 'резюме', 'кандидаты'],
  },
  {
    name: 'Стандарт Online',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 52000,
    description:
      'Подбор удалённого менеджера: профиль вакансии, портрет соискателя, скрининг и интервью.',
    skills: ['подбор', 'удалённо', 'менеджер', 'вакансия', 'интервью'],
  },
  {
    name: 'CRM Бронза',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 60000,
    description:
      'Базовый запуск CRM: аудит, ТЗ, воронки до 3, роботы, статусы отказа и базовые настройки.',
    skills: ['crm бронза', 'аудит', 'тз', 'воронка', 'роботы', 'статусы отказа'],
  },
  {
    name: 'Офис',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 67000,
    description:
      'Подбор менеджера в офис: профиль вакансии, портрет соискателя, скрининг и интервью.',
    skills: ['подбор', 'офис', 'менеджер', 'интервью'],
  },
  {
    name: 'Стандарт Online PRO',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 69000,
    description:
      'Расширенный подбор удалённого менеджера с увеличенным сроком проекта и гарантией.',
    skills: ['подбор', 'удалённо', 'pro', 'гарантия'],
  },
  {
    name: 'Офис PRO',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 95000,
    description:
      'Расширенный подбор менеджера в офис с гарантией и полным циклом отбора.',
    skills: ['подбор', 'офис', 'pro', 'гарантия'],
  },
  {
    name: 'Эксперт-фокус',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 100000,
    description:
      'Подбор менеджера-эксперта узкой специализации с гарантией.',
    skills: ['подбор', 'эксперт', 'гарантия'],
  },
  {
    name: 'CRM Серебро',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 100000,
    description:
      'Расширенная настройка CRM: аудит, ТЗ, сотрудники, роли, импорт базы, документы и воронки.',
    skills: ['crm серебро', 'аудит', 'импорт базы', 'воронки', 'автоматизация'],
  },
  {
    name: 'РОП-фокус',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 150000,
    description:
      'Подбор руководителя отдела продаж: профиль вакансии, портрет, скрининг и интервью.',
    skills: ['роп-фокус', 'подбор', 'руководитель отдела продаж'],
  },
  {
    name: 'ТОП-фокус',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 200000,
    description:
      'Подбор топ-менеджмента: профиль вакансии, портрет соискателя, скрининг и интервью.',
    skills: ['топ-фокус', 'подбор', 'топ-менеджмент'],
  },
  {
    name: 'CRM Золото',
    category: 'Пакет услуг',
    type: ServiceType.Service,
    price: 200000,
    description:
      'Полный запуск CRM: аудит, ТЗ, сотрудники и роли, импорт базы, документы, воронки и роботы.',
    skills: ['crm золото', 'полный запуск', 'роботы', 'документы', 'воронки'],
  },
  {
    name: 'HRD',
    category: 'Эксперты',
    type: ServiceType.Service,
    price: 0,
    description:
      'Экспертная поддержка по вопросам управления персоналом и построения HR-системы.',
    skills: ['эксперт', 'hr', 'персонал'],
  },
  {
    name: 'ИИ РОП',
    category: 'Управление продажами',
    type: ServiceType.Service,
    price: 0,
    description:
      'Управление отделом продаж с помощью ИИ: анализ менеджеров, звонков, переписок и KPI.',
    skills: ['ии роп', 'управление', 'аналитика', 'kpi', 'звонки'],
  },
  {
    name: 'РОП на аутсорсинге',
    category: 'Управление продажами',
    type: ServiceType.Service,
    price: 0,
    description:
      'Опытный руководитель продаж без найма штатного сотрудника: управление командой, KPI и контроль планов.',
    skills: ['роп', 'аутсорсинг', 'управление', 'kpi'],
  },
  {
    name: 'Финансовый директор',
    category: 'Эксперты',
    type: ServiceType.Service,
    price: 0,
    description:
      'Экспертная поддержка по финансовому управлению, прибыльности, маржинальности и планированию.',
    skills: ['финансовый директор', 'финансы', 'маржа', 'прибыль'],
  },
  {
    name: 'Руководитель отдела продаж',
    category: 'Эксперты',
    type: ServiceType.Service,
    price: 0,
    description:
      'Экспертная поддержка собственника, РОПа или коммерческого директора по управлению продажами.',
    skills: ['руководитель отдела продаж', 'роп', 'управление', 'выручка'],
  },
  {
    name: 'На Контроле + Рубичат',
    category: 'Контроль качества',
    type: ServiceType.Service,
    price: 0,
    description:
      'Контроль качества коммуникаций с клиентами: анализ звонков, переписок и KPI менеджеров.',
    skills: ['на контроле', 'рубичат', 'качество', 'звонки', 'переписки'],
  },
  {
    name: 'Коммерческий директор на аутсорсинге',
    category: 'Управление продажами',
    type: ServiceType.Service,
    price: 0,
    description:
      'Стратегическое управление продажами, маркетингом и коммерческим развитием на аутсорсинге.',
    skills: ['коммерческий директор', 'аутсорсинг', 'стратегия'],
  },
  {
    name: 'SofIHR (самостоятельный подбор)',
    category: 'Подбор персонала',
    type: ServiceType.Service,
    price: 0,
    description:
      'Доступ к платформе и инструментам скрининга резюме для самостоятельного подбора персонала.',
    skills: ['подбор', 'самостоятельный', 'скрининг', 'резюме'],
  },
  {
    name: 'Коммерческий директор',
    category: 'Эксперты',
    type: ServiceType.Service,
    price: 0,
    description:
      'Экспертная поддержка по управлению продажами, развитию бизнеса и коммерческой стратегии.',
    skills: ['коммерческий директор', 'стратегия', 'продажи'],
  },
  {
    name: 'Подбор под ключ',
    category: 'Подбор персонала',
    type: ServiceType.Service,
    price: 0,
    description:
      'Комплексная услуга по поиску, отбору и найму сотрудников от профиля вакансии до финального кандидата.',
    skills: ['подбор под ключ', 'найм', 'вакансия'],
  },
  {
    name: 'Документ под запрос',
    category: 'Документы',
    type: ServiceType.Document,
    price: 0,
    description:
      'Подготовка индивидуального документа под запрос клиента на основе вводных данных.',
    skills: ['документы', 'под заказ'],
  },
  {
    name: 'Регламент проведения планёрок',
    category: 'Документы',
    type: ServiceType.Document,
    price: 1000,
    description:
      'Описание порядка, формата и периодичности совещаний отдела продаж.',
    skills: ['регламент', 'планёрки', 'документы'],
  },
  {
    name: 'Инструкция по заполнению дашборда и отчётности',
    category: 'Документы',
    type: ServiceType.Document,
    price: 1000,
    description:
      'Правила внесения данных о продажах, конверсии и KPI в систему отчётности и дашборд.',
    skills: ['документы', 'дашборд', 'отчётность'],
  },
  {
    name: 'Телефонное интервью',
    category: 'Подбор персонала',
    type: ServiceType.Service,
    price: 2000,
    description:
      'Первичные беседы с кандидатами для оценки профессиональных навыков, мотивации и личностных качеств.',
    skills: ['подбор', 'интервью', 'телефонное интервью'],
  },
  {
    name: 'Подготовка плана тренингов',
    category: 'Система обучения',
    type: ServiceType.Service,
    price: 3000,
    description:
      'Разработка программы обучения менеджеров с учётом задач компании, уровня навыков и этапов продаж.',
    skills: ['обучение', 'план тренингов'],
  },
  {
    name: 'Интеграция почты',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 3000,
    description:
      'Подключение электронной почты к CRM для фиксации переписки и связи писем с клиентами и сделками.',
    skills: ['crm', 'почта', 'интеграция', 'email'],
  },
  {
    name: 'Распределение прав доступа по сотрудникам',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 3000,
    description:
      'Настройка уровней и ограничений доступа в CRM для разных сотрудников и ролей.',
    skills: ['crm', 'права доступа', 'безопасность'],
  },
  {
    name: 'Настройка статусов отказа',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 3000,
    description:
      'Структурирование причин потери клиентов и несостоявшихся сделок в CRM.',
    skills: ['crm', 'статусы отказа', 'аналитика'],
  },
  {
    name: 'Техническая поддержка (час)',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 3000,
    description:
      'Час технической поддержки пользователей CRM: консультации, исправление ошибок и настройка функционала.',
    skills: ['crm', 'поддержка'],
  },
  {
    name: 'Подготовка демонстрации должности МОП',
    category: 'Система обучения',
    type: ServiceType.Service,
    price: 4000,
    description:
      'Наглядное представление обязанностей, задач и процессов работы менеджера по продажам.',
    skills: ['обучение', 'демонстрация', 'моп'],
  },
  {
    name: 'Запись обучающего видео по работе с системой',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 4000,
    description:
      'Создание видео о работе с CRM, воронками, карточками и автоматизациями.',
    skills: ['crm', 'обучение', 'видео'],
  },
  {
    name: 'Видео-интервью',
    category: 'Подбор персонала',
    type: ServiceType.Service,
    price: 4000,
    description:
      'Удалённые интервью с кандидатами по видеосвязи для оценки навыков и коммуникации.',
    skills: ['подбор', 'интервью', 'видео'],
  },
  {
    name: 'Загрузка баз контактов (до 10 000)',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 4000,
    description:
      'Перенос существующих данных о клиентах и компаниях в CRM с сохранением структуры и важных полей.',
    skills: ['crm', 'миграция', 'база контактов'],
  },
  {
    name: 'Рабочая инструкция МП',
    category: 'Документы',
    type: ServiceType.Document,
    price: 5000,
    description:
      'Пошаговое руководство по ежедневным задачам и процессам менеджера по продажам.',
    skills: ['документы', 'инструкция', 'мп'],
  },
  {
    name: 'Настройка воронок сделок (до 3 шт)',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 5000,
    description:
      'Создание логики движения клиента в CRM по этапам продаж и действиям менеджеров.',
    skills: ['crm', 'воронка', 'сделки'],
  },
  {
    name: 'Настройка роботов для автоматизации',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 5000,
    description:
      'Создание автоматических сценариев в CRM: постановка задач, уведомления и смена этапов.',
    skills: ['crm', 'роботы', 'автоматизация'],
  },
  {
    name: 'Настройка карточек сделок, контактов, компаний (до 3 шт)',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 5000,
    description:
      'Формирование структуры и полей карточек CRM для клиентов, сделок и компаний.',
    skills: ['crm', 'карточки', 'настройка'],
  },
  {
    name: 'Добавление шаблонов документов (до 3 шт)',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 5000,
    description:
      'Создание шаблонов договоров, счетов, коммерческих предложений и других документов в CRM.',
    skills: ['crm', 'документы', 'шаблоны'],
  },
  {
    name: 'Настройка отчёта',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 5000,
    description:
      'Создание CRM-отчёта для визуализации продаж, KPI, эффективности менеджеров и работы воронки.',
    skills: ['crm', 'отчёт', 'аналитика'],
  },
  {
    name: 'Добавление сотрудников и корректировка ролей (до 5)',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 5000,
    description:
      'Регистрация пользователей CRM, назначение ролей, прав доступа и привязка к отделам.',
    skills: ['crm', 'сотрудники', 'роли'],
  },
  {
    name: 'Настройка шаблонов задач',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 5000,
    description:
      'Создание повторяющихся задач CRM с описанием действий, сроков и ответственных.',
    skills: ['crm', 'задачи', 'шаблоны'],
  },
  {
    name: 'Должностная инструкция МП',
    category: 'Документы',
    type: ServiceType.Document,
    price: 5000,
    description:
      'Описание обязанностей, ответственности и KPI менеджера по продажам.',
    skills: ['документы', 'должностная инструкция'],
  },
  {
    name: 'Регламент работы отдела продаж',
    category: 'Документы',
    type: ServiceType.Document,
    price: 5000,
    description:
      'Правила взаимодействия сотрудников, распределение ролей и порядок ведения процессов продаж.',
    skills: ['документы', 'регламент', 'отдел продаж'],
  },
  {
    name: 'Адаптационный план МП',
    category: 'Документы',
    type: ServiceType.Document,
    price: 5000,
    description:
      'План ввода нового сотрудника в работу отдела: продукт, процессы, CRM и стандарты.',
    skills: ['документы', 'адаптация', 'мп'],
  },
  {
    name: 'Отчёт с оценкой прослушанных разговоров с клиентами',
    category: 'Контроль качества',
    type: ServiceType.Service,
    price: 5000,
    description:
      'Анализ звонков менеджеров по чек-листу: коммуникация, скрипты, логика продаж и ошибки.',
    skills: ['контроль', 'звонки', 'отчёт'],
  },
  {
    name: 'Отчёт с оценкой проанализированных переписок с клиентами',
    category: 'Контроль качества',
    type: ServiceType.Service,
    price: 5000,
    description:
      'Оценка письменной коммуникации менеджеров в мессенджерах и чатах.',
    skills: ['контроль', 'переписка', 'отчёт'],
  },
  {
    name: 'Аналитический отчёт по отказным сделкам',
    category: 'Контроль качества',
    type: ServiceType.Service,
    price: 5000,
    description:
      'Разбор причин, по которым клиенты не доходят до покупки, и поиск точек потери на этапах воронки.',
    skills: ['контроль', 'отказы', 'аналитика'],
  },
  {
    name: 'Отчёт по ведению сделок в CRM',
    category: 'Контроль качества',
    type: ServiceType.Service,
    price: 5000,
    description:
      'Проверка корректности ведения карточек клиентов, этапов сделок, задач и комментариев в CRM.',
    skills: ['контроль', 'crm', 'сделки'],
  },
  {
    name: 'Проведение упражнения на отработку навыка',
    category: 'Система обучения',
    type: ServiceType.Service,
    price: 7000,
    description:
      'Практическое занятие, где менеджеры отрабатывают конкретные навыки на реальных сценариях.',
    skills: ['обучение', 'навыки', 'упражнение'],
  },
  {
    name: 'Мотивация МОП',
    category: 'Документы',
    type: ServiceType.Document,
    price: 7000,
    description:
      'Система мотивации сотрудников отдела продаж: бонусы, KPI, премии и правила поощрения.',
    skills: ['документы', 'мотивация', 'kpi'],
  },
  {
    name: 'Инструкция по работе в CRM',
    category: 'Документы',
    type: ServiceType.Document,
    price: 7000,
    description:
      'Правила использования CRM: ведение клиентов, сделок, задач и отчётности.',
    skills: ['документы', 'crm', 'инструкция'],
  },
  {
    name: 'Проведение проблематизирующего упражнения',
    category: 'Система обучения',
    type: ServiceType.Service,
    price: 7000,
    description:
      'Практическое занятие для выявления слабых мест и типичных ошибок менеджеров.',
    skills: ['обучение', 'упражнение', 'ошибки'],
  },
  {
    name: 'Аудит CRM',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 7000,
    description:
      'Диагностика CRM: как используются поля, где теряются заявки и какие процессы настроены некорректно.',
    skills: ['crm', 'аудит'],
  },
  {
    name: 'Проведение тренинга',
    category: 'Система обучения',
    type: ServiceType.Service,
    price: 7000,
    description:
      'Обучающее занятие для менеджеров по продажам, направленное на развитие навыков и стандартов работы.',
    skills: ['обучение', 'тренинг'],
  },
  {
    name: 'Подготовка системы адаптации МОП (onboarding)',
    category: 'Система обучения',
    type: ServiceType.Service,
    price: 8000,
    description:
      'План введения нового менеджера в работу отдела продаж: продукт, процессы, CRM и стандарты.',
    skills: ['обучение', 'адаптация', 'onboarding'],
  },
  {
    name: 'Подготовка системы аттестации МОП',
    category: 'Система обучения',
    type: ServiceType.Service,
    price: 8000,
    description:
      'Критерии и методики оценки знаний, навыков и результатов менеджеров по продажам.',
    skills: ['обучение', 'аттестация'],
  },
  {
    name: 'Добавление карточек товара (до 30 шт)',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 8000,
    description:
      'Создание в CRM карточек продуктов с характеристиками, ценами и важными данными.',
    skills: ['crm', 'товары', 'карточки'],
  },
  {
    name: 'Портрет соискателя',
    category: 'Подбор персонала',
    type: ServiceType.Document,
    price: 8000,
    description:
      'Описание идеального кандидата для вакансии: навыки, качества, мотивация и стиль работы.',
    skills: ['подбор', 'портрет соискателя'],
  },
  {
    name: 'Разработка и интеграция бизнес-процесса',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 10000,
    description:
      'Проектирование логики работы отдела продаж внутри CRM с учётом этапов, задач и автоматизаций.',
    skills: ['crm', 'бизнес-процесс', 'интеграция'],
  },
  {
    name: 'Дашборд ОП',
    category: 'Документы',
    type: ServiceType.Document,
    price: 10000,
    description:
      'Панель с ключевыми показателями работы команды: конверсия, выручка, KPI и активность менеджеров.',
    skills: ['дашборд оп', 'аналитика', 'kpi'],
  },
  {
    name: 'Профиль вакансии',
    category: 'Подбор персонала',
    type: ServiceType.Document,
    price: 10000,
    description:
      'Детализированное описание должности, обязанностей, требований и компетенций кандидата.',
    skills: ['подбор', 'профиль вакансии'],
  },
  {
    name: 'Аудит портала',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 10000,
    description:
      'Проверка состояния клиентского или корпоративного портала: структура, функциональность и удобство.',
    skills: ['портал', 'аудит'],
  },
  {
    name: 'Интеграция телефонии',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 20000,
    description:
      'Подключение телефонии к CRM для фиксации звонков, записи разговоров и распределения вызовов.',
    skills: ['crm', 'интеграция телефонии', 'звонки'],
  },
  {
    name: 'Скрипт продаж',
    category: 'Документы',
    type: ServiceType.Document,
    price: 20000,
    description:
      'Набор речевых и письменных шаблонов для общения с клиентами: звонки, переписки и презентации.',
    skills: ['скрипт продаж', 'документы', 'коммуникация'],
  },
  {
    name: 'Интеграция мессенджера',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 20000,
    description:
      'Подключение мессенджеров к CRM для фиксации переписок и распределения сообщений между менеджерами.',
    skills: ['crm', 'интеграция мессенджера', 'переписки'],
  },
  {
    name: 'Подготовка технического задания',
    category: 'CRM система',
    type: ServiceType.Document,
    price: 20000,
    description:
      'Детальный план настройки CRM: структура воронки, логика сделок, поля, автоматизации и интеграции.',
    skills: ['crm', 'тз', 'техническое задание'],
  },
  {
    name: 'Базовая настройка работы отдела продаж',
    category: 'CRM система',
    type: ServiceType.Service,
    price: 60000,
    description:
      'Аудит, ТЗ, создание воронок до 2, сотрудники, роли и базовые документы для отдела продаж.',
    skills: ['crm', 'базовая настройка', 'отдел продаж', 'воронки'],
  },
  {
    name: 'Книга продаж',
    category: 'Документы',
    type: ServiceType.Document,
    price: 70000,
    description:
      'Структурированная база знаний отдела продаж: что продаём, как продаём, стандарты и лучшие практики.',
    skills: ['документы', 'книга продаж', 'стандарты', 'обучение'],
  },
];

export class SeedAltaSalesRecommendationServices1780200000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    const categoryIds = new Map<string, string>();

    for (const category of categories) {
      await queryRunner.query(
        `
          INSERT INTO "category" ("name", "slug", "description")
          VALUES ($1, $2, $3)
          ON CONFLICT ("name") DO UPDATE SET
            "slug" = COALESCE("category"."slug", EXCLUDED."slug"),
            "description" = COALESCE("category"."description", EXCLUDED."description")
        `,
        [category.name, category.slug, category.description],
      );

      const [row] = await queryRunner.query(
        'SELECT "id" FROM "category" WHERE "name" = $1 LIMIT 1',
        [category.name],
      );
      categoryIds.set(category.name, row.id);
    }

    for (const service of services) {
      const categoryId = categoryIds.get(service.category) ?? null;

      const [existing] = await queryRunner.query(
        `
          SELECT "id"
          FROM "service"
          WHERE lower("name") = lower($1)
            AND "type" = $2
          LIMIT 1
        `,
        [service.name, service.type],
      );

      if (existing?.id) {
        await queryRunner.query(
          `
            UPDATE "service"
            SET
              "description" = $2,
              "categoryId" = $3,
              "price" = $4,
              "skills" = $5,
              "deletedAt" = NULL
            WHERE "id" = $1
          `,
          [
            existing.id,
            service.description,
            categoryId,
            service.price,
            JSON.stringify(service.skills),
          ],
        );
        continue;
      }

      await queryRunner.query(
        `
          INSERT INTO "service" (
            "type", "name", "description", "categoryId", "price", "image", "skills", "deletedAt"
          )
          VALUES ($1, $2, $3, $4, $5, NULL, $6, NULL)
        `,
        [
          service.type,
          service.name,
          service.description,
          categoryId,
          service.price,
          JSON.stringify(service.skills),
        ],
      );
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op: this migration seeds/updates production catalog data. Deleting
    // services on rollback could break existing orders and recommendations.
  }
}
