export type RecommendationCatalogItemKind = 'package' | 'service';

export type RecommendationCatalogEntry = {
  id: string;
  kind: RecommendationCatalogItemKind;
  displayName: string;
  legacyAliases: string[];
  requiredForValidation?: boolean;
  availableForRecommendations?: boolean;
};

export const RECOMMENDATION_CATALOG = {
  salesDepartmentFromZero: {
    id: '48bb369e-3fce-442c-bdbb-e587c2b1051f',
    kind: 'package',
    displayName: 'Отдел продаж с нуля',
    legacyAliases: ['отдел продаж с нуля'],
  },
  crmStart: {
    id: '292a8ec3-ea07-4326-9bb8-fed6056b3b20',
    kind: 'package',
    displayName: 'CRM Старт',
    legacyAliases: ['crm старт'],
  },
  crmBronze: {
    id: '4f78d603-8cad-4a21-9c7c-36539eab062f',
    kind: 'package',
    displayName: 'CRM Бронза',
    legacyAliases: ['crm бронза'],
  },
  hiringOffice: {
    id: '9b73e43c-f7cf-4e08-aa6c-8bd456718339',
    kind: 'package',
    displayName: 'Офис',
    legacyAliases: ['офис', 'подбор под ключ'],
  },
  trainingOneMonth: {
    id: 'ad4dfc35-b81d-423b-afc0-ff52963617a1',
    kind: 'package',
    displayName: 'Пакет обучения на месяц',
    legacyAliases: ['пакет обучения на месяц'],
  },
  trainingThreeMonths: {
    id: 'e7db5483-a08b-4bce-aca0-d8aa5a9fb375',
    kind: 'package',
    displayName: 'Пакет обучения на 3 месяца',
    legacyAliases: ['пакет обучения на 3 месяца'],
  },
  salesDocumentsPackage: {
    id: 'c6fe341c-b75f-449f-a2d0-9d7d3286d71a',
    kind: 'package',
    displayName: 'Пакет документов отдела продаж',
    legacyAliases: ['пакет документов отдела продаж'],
  },
  outsourcedSalesHead: {
    id: 'c0339da2-4286-4eac-b2f8-04bf9b925a46',
    kind: 'service',
    displayName: 'РОП на аутсорсинге',
    legacyAliases: ['роп на аутсорсинге'],
  },
  salesHead: {
    id: 'f02bd1fa-77a6-419e-bfa4-c71e293efb4f',
    kind: 'service',
    displayName: 'Руководитель отдела продаж',
    legacyAliases: ['руководитель отдела продаж'],
  },
  salesHeadExpertConsultation: {
    id: 'cfc96602-9c0b-45af-809b-725b0d198993',
    kind: 'service',
    requiredForValidation: false,
    displayName: 'Эксперт РОП: консультация',
    legacyAliases: ['эксперт роп', 'консультация роп'],
  },
  aiSalesHead: {
    id: 'e1cbfa1b-8643-42a1-944d-9f1f93522814',
    kind: 'service',
    displayName: 'ИИ РОП',
    legacyAliases: ['ии роп'],
  },
  aiCrmAnalysis: {
    id: 'f5012878-be3f-448f-a10d-1507eb422442',
    kind: 'service',
    displayName: '\u0418\u0418 \u0430\u043d\u0430\u043b\u0438\u0437 CRM',
    legacyAliases: [],
  },
  aiDashboardAnalysis: {
    id: '93404cd2-5292-40c0-a5a3-f77e8709a904',
    kind: 'service',
    requiredForValidation: false,
    availableForRecommendations: false,
    displayName:
      '\u0418\u0418 \u0430\u043d\u0430\u043b\u0438\u0437 \u0434\u0430\u0448\u0431\u043e\u0440\u0434\u0430',
    legacyAliases: [],
  },
  aiDocumentAnalysis: {
    id: '68b641f3-5f6f-4d30-9f56-f77cb9cce9ed',
    kind: 'service',
    displayName:
      '\u0418\u0418 \u0430\u043d\u0430\u043b\u0438\u0437 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u043e\u0432',
    legacyAliases: [],
  },
  aiCallManagersAnalysis: {
    id: 'd2dc70e0-0774-4401-ae25-d15662fe1877',
    kind: 'service',
    displayName: 'ИИ анализ звонков и менеджеров',
    legacyAliases: [],
  },
  salesHeadFocus: {
    id: 'b7ddadc8-4654-4d73-9e9a-3a5e3e858f89',
    kind: 'package',
    displayName: 'РОП-фокус',
    legacyAliases: ['роп-фокус'],
  },
  salesScript: {
    id: 'e998428c-935f-4fd6-8994-e17ff979131f',
    kind: 'service',
    displayName: 'Скрипт продаж',
    legacyAliases: ['скрипт продаж'],
  },
  salesDashboard: {
    id: '7bbf50a5-61b6-4adf-a930-d54a06db49af',
    kind: 'service',
    displayName: 'Дашборд ОП',
    legacyAliases: ['дашборд оп'],
  },
  contactDatabase: {
    id: '2b7f17ef-54c8-4f4f-b882-203186809ac1',
    kind: 'service',
    displayName: 'Загрузка баз контактов (до 10 000)',
    legacyAliases: ['загрузка баз контактов', 'база контактов'],
  },
  telephonyIntegration: {
    id: '3dd98b30-1d7c-4c99-b8bd-0bb8cfcbcaca',
    kind: 'service',
    displayName: 'Интеграция телефонии',
    legacyAliases: ['интеграция телефонии'],
  },
  messengerIntegration: {
    id: 'da4c0e35-54a8-41f4-88a7-78e43c0ae5be',
    kind: 'service',
    displayName: 'Интеграция мессенджера',
    legacyAliases: ['интеграция мессенджера'],
  },
  communicationQualityControl: {
    id: '35e58eac-be7c-49b5-a483-d1a3e526e9b7',
    kind: 'service',
    requiredForValidation: false,
    displayName: 'На Контроле + Рубичат',
    legacyAliases: ['на контроле + рубичат', 'на контроле'],
  },
  callAnalysis: {
    id: '3d82eea7-ce89-42d7-8a7f-1c825b648c84',
    kind: 'service',
    requiredForValidation: false,
    displayName: 'Отчёт с оценкой прослушанных разговоров с клиентами',
    legacyAliases: ['отчет с оценкой прослушанных разговоров с клиентами'],
  },
  messengerAnalysis: {
    id: '58ce0e46-47a3-47f8-be16-a35a16dfd87d',
    kind: 'service',
    displayName: 'Отчёт с оценкой проанализированных переписок с клиентами',
    legacyAliases: ['отчет с оценкой проанализированных переписок с клиентами'],
  },
  crmAudit: {
    id: '14a3ab40-9909-49e7-8f66-6f6d10332951',
    kind: 'service',
    displayName: 'Аудит CRM',
    legacyAliases: ['аудит crm'],
  },
  crmDealsAnalysis: {
    id: '05d9cfb9-f5b8-4c26-b5b6-b5490175ff55',
    kind: 'service',
    displayName: 'Отчёт по ведению сделок в CRM',
    legacyAliases: ['отчет по ведению сделок в crm'],
  },
  rejectedDealsAnalysis: {
    id: '8b8508c1-9e8b-44c7-a7b7-639bf0afe8a6',
    kind: 'service',
    requiredForValidation: false,
    displayName: 'Аналитический отчёт по отказным сделкам',
    legacyAliases: [
      'аналитический отчет по отказным сделкам',
      'отчет по отказным сделкам',
    ],
  },
  documentAnalysis: {
    id: '9ca7871e-3301-4ff8-981c-30f10e3c2880',
    kind: 'service',
    displayName: 'Документ под запрос',
    legacyAliases: ['документ под запрос'],
  },
  voiceAutomation: {
    id: 'ee7354a1-e796-4ef7-a75d-502c8246949d',
    kind: 'service',
    displayName: 'Настройка роботов для автоматизации',
    legacyAliases: ['настройка роботов для автоматизации'],
  },
} as const satisfies Record<string, RecommendationCatalogEntry>;

export type RecommendationCatalogKey = keyof typeof RECOMMENDATION_CATALOG;

/**
 * Returns the canonical display name and compatibility aliases for catalog
 * matching. Stable IDs remain the source of truth whenever a candidate has a
 * configured catalog ID; aliases only support legacy fixtures and records
 * that predate the catalog registry.
 */
export function getRecommendationCatalogAliases(
  ...keys: RecommendationCatalogKey[]
): string[] {
  return Array.from(
    new Set(
      keys.flatMap((key) => {
        const entry = RECOMMENDATION_CATALOG[key];
        return [entry.displayName, ...entry.legacyAliases];
      }),
    ),
  );
}

export function getRecommendationCatalogLegacyAliases(
  ...keys: RecommendationCatalogKey[]
): string[] {
  return Array.from(
    new Set(keys.flatMap((key) => RECOMMENDATION_CATALOG[key].legacyAliases)),
  );
}

export const RECOMMENDATION_CATALOG_ENTRIES = Object.values(
  RECOMMENDATION_CATALOG,
) as RecommendationCatalogEntry[];

export const REQUIRED_RECOMMENDATION_CATALOG_ENTRIES =
  RECOMMENDATION_CATALOG_ENTRIES.filter(
    (entry) => entry.requiredForValidation !== false,
  );

export const DISABLED_RECOMMENDATION_CATALOG_IDS = new Set(
  RECOMMENDATION_CATALOG_ENTRIES.filter(
    (entry) => entry.availableForRecommendations === false,
  ).map((entry) => entry.id),
);
