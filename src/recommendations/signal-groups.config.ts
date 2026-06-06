import { RecommendationPriority } from './entities/recommendation-priority.enum';

export type SignalGroup = {
  signal: string;
  title: string;
  priority: RecommendationPriority;
  weight: number;
  diagnosticTerms: string[];
  serviceTerms: string[];
};

export const SIGNAL_GROUPS: SignalGroup[] = [
  {
    signal: 'revenue_risk',
    title: 'risk to revenue plan',
    priority: RecommendationPriority.Urgent,
    weight: 5,
    diagnosticTerms: [
      'выруч', 'revenue', 'план', 'plan', 'деньг', 'прибыл',
      'profit', 'марж', 'потер', 'risk', 'риск',
    ],
    serviceTerms: [
      'выруч', 'revenue', 'финанс', 'profit', 'марж', 'аудит',
      'audit', 'аналит', 'стратег',
    ],
  },
  {
    signal: 'funnel_conversion',
    title: 'leaking funnel conversion',
    priority: RecommendationPriority.Urgent,
    weight: 4,
    diagnosticTerms: [
      'конверс', 'conversion', 'воронк', 'funnel', 'лид', 'lead',
      'сделк', 'deal', 'отказ',
    ],
    serviceTerms: [
      'конверс', 'conversion', 'воронк', 'funnel', 'лид', 'lead',
      'сделк', 'deal',
    ],
  },
  {
    signal: 'lead_generation_gap',
    title: 'lead generation gap',
    priority: RecommendationPriority.Urgent,
    weight: 4,
    diagnosticTerms: [
      'лидоген', 'лидген', 'leadgen', 'заявк', 'traffic', 'трафик',
      'входящ', 'исходящ', 'outbound', 'inbound', 'канал', 'source', 'источник',
    ],
    serviceTerms: [
      'лидоген', 'лидген', 'leadgen', 'заявк', 'traffic', 'трафик',
      'входящ', 'исходящ', 'outbound', 'inbound', 'канал', 'source',
      'источник', 'привлеч',
    ],
  },
  {
    signal: 'analytics_visibility',
    title: 'missing sales analytics',
    priority: RecommendationPriority.Medium,
    weight: 3,
    diagnosticTerms: [
      'аналит', 'analytics', 'отчет', 'report', 'дашборд', 'dashboard',
      'сквозн', 'метрик', 'metrics', 'roi', 'romi', 'источник', 'source',
    ],
    serviceTerms: [
      'аналит', 'analytics', 'отчет', 'report', 'дашборд', 'dashboard',
      'сквозн', 'метрик', 'metrics', 'roi', 'romi',
    ],
  },
  {
    signal: 'crm_quality',
    title: 'poor CRM data quality',
    priority: RecommendationPriority.Medium,
    weight: 3,
    diagnosticTerms: [
      'crm', 'данн', 'data', 'дубл', 'duplicate', 'статус', 'status',
      'задач', 'task',
    ],
    serviceTerms: [
      'crm', 'данн', 'data', 'дубл', 'duplicate', 'статус', 'status',
      'интеграц', 'автоматизац',
    ],
  },
  {
    signal: 'retention_growth',
    title: 'weak retention and repeat sales',
    priority: RecommendationPriority.Medium,
    weight: 3,
    diagnosticTerms: [
      'retention', 'удерж', 'повтор', 'repeat', 'ltv', 'churn',
      'отток', 'возврат', 'лояльн', 'клиентск',
    ],
    serviceTerms: [
      'retention', 'удерж', 'повтор', 'repeat', 'ltv', 'churn',
      'отток', 'возврат', 'лояльн', 'клиентск', 'crm',
    ],
  },
  {
    signal: 'unit_economics',
    title: 'unit economics pressure',
    priority: RecommendationPriority.Medium,
    weight: 3,
    diagnosticTerms: [
      'cac', 'cpa', 'cpl', 'юнит', 'unit', 'себестоим', 'маржин',
      'окупаем', 'payback', 'стоимость лида', 'стоимость клиента',
    ],
    serviceTerms: [
      'cac', 'cpa', 'cpl', 'юнит', 'unit', 'маржин', 'экономик',
      'окупаем', 'payback', 'аналит', 'финанс',
    ],
  },
  {
    signal: 'team_performance',
    title: 'sales team execution gap',
    priority: RecommendationPriority.Medium,
    weight: 3,
    diagnosticTerms: [
      'менедж', 'manager', 'команд', 'team', 'дисциплин', 'discipline',
      'kpi', 'скрипт', 'script',
    ],
    serviceTerms: [
      'менедж', 'manager', 'команд', 'team', 'kpi', 'скрипт',
      'script', 'обуч', 'training',
    ],
  },
  {
    signal: 'sales_process',
    title: 'missing sales process',
    priority: RecommendationPriority.Medium,
    weight: 2,
    diagnosticTerms: [
      'регламент', 'process', 'процесс', 'обуч', 'training',
      'документ', 'document', 'контроль', 'control',
    ],
    serviceTerms: [
      'регламент', 'process', 'процесс', 'обуч', 'training',
      'документ', 'document', 'контроль', 'control', 'стандарт',
    ],
  },
];
