import { BadRequestException, Logger } from '@nestjs/common';
import { LlmProxyService } from '../ai/llm-proxy.service';
import { ServiceType } from '../services/entities/service-type.enum';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import {
  RecommendationScoringService,
  type ServiceCandidate,
} from './recommendation-scoring.service';

describe('RecommendationScoringService', () => {
  const llmProxy = {
    chat: jest.fn(),
  };

  let service: RecommendationScoringService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    llmProxy.chat.mockReset();
    service = new RecommendationScoringService(
      llmProxy as unknown as LlmProxyService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves priority by score and urgent signals', () => {
    expect(service.resolvePriority(0, [])).toBe(RecommendationPriority.Low);
    expect(service.resolvePriority(3, [])).toBe(RecommendationPriority.Medium);
    expect(
      service.resolvePriority(1, [{ priority: RecommendationPriority.Urgent }]),
    ).toBe(RecommendationPriority.Urgent);
  });

  it('matches exact short terms without substring false positives', () => {
    const candidate = {
      id: 'service-id',
      name: 'Revenue audit',
      description: 'Revenue and profit analytics',
      type: ServiceType.Service,
      skills: [],
      category: null,
    } as unknown as ServiceCandidate;

    const falsePositive = service.scoreService(
      candidate,
      service.normalizeText('planetary discussion'),
    );
    const exactMatch = service.scoreService(
      candidate,
      service.normalizeText('revenue plan is at risk'),
    );

    expect(falsePositive.score).toBe(0);
    expect(exactMatch.score).toBeGreaterThan(0);
  });

  it('builds normalized diagnostic context', () => {
    expect(
      service.buildDiagnosticContext({
        userId: 'user-id',
        clientProfile: { channel: 'CRM' },
        diagnostics: ['Revenue   PLAN'],
      }),
    ).toContain('revenue plan');
  });

  it('logs and falls back when AI returns invalid JSON', async () => {
    llmProxy.chat.mockResolvedValueOnce({ content: 'not json' });

    await expect(
      service.generateAiRecommendations(
        {
          userId: 'user-id',
          diagnostics: ['revenue plan'],
        },
        [],
        'revenue plan',
      ),
    ).resolves.toEqual({
      summary: expect.stringMatching(/[а-яё]/i),
      recommendations: [],
    });
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('logs and falls back when anonymization validation fails', async () => {
    const error = new BadRequestException(
      'LLM request validation failed',
    ) as BadRequestException & { safeErrorCode: string };
    error.safeErrorCode = 'AI_VALIDATION_FAILED';
    llmProxy.chat.mockRejectedValueOnce(error);

    await expect(
      service.generateAiRecommendations(
        {
          userId: 'user-id',
          diagnostics: ['revenue plan'],
        },
        [],
        'revenue plan',
      ),
    ).resolves.toEqual({
      summary: expect.stringMatching(/[а-яё]/i),
      recommendations: [],
    });
    expect(Logger.prototype.warn).toHaveBeenCalledWith({
      eventName: 'AI_RECOMMENDATION_GENERATION_FAILED',
      error: 'LLM request validation failed',
    });
  });

  it('accepts serviceId from AI recommendation output', async () => {
    const candidate = {
      id: 'service-id',
      name: 'CRM Silver',
      description: 'Advanced CRM launch service',
      type: ServiceType.Service,
      skills: ['CRM', 'analytics'],
      category: { name: 'Пакет услуг' },
    } as unknown as ServiceCandidate;
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"serviceId":"service-id","priority":"medium","rationale":"Best serv' +
        'ice fit","diagnosticSignals":["crm_quality"]}]}',
    });

    const result = await service.generateAiRecommendations(
      {
        userId: 'user-id',
        diagnostics: ['CRM data quality'],
      },
      [candidate],
      'crm data quality',
    );

    expect(result.recommendations[0]).toMatchObject({
      serviceId: 'service-id',
    });
    expect(result.recommendations[0].rationale).toMatch(/[а-яё]/i);
  });

  it('keeps a valid AI-only semantic recommendation with Russian rationale', async () => {
    const candidate = {
      id: 'semantic-service-id',
      name: 'Сложная внедренческая услуга',
      description: 'Индивидуальный формат без ключевых слов диагностики',
      type: ServiceType.Service,
      skills: [],
      category: null,
    } as unknown as ServiceCandidate;
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"serviceId":"semantic-service-id","priority":"medium","rationale":"' +
        'Подходит, потому что нужна внедренческая настройка под клиента.","diagnosticSignals":["c' +
        'ustom_fit"]}]}',
    });

    const result = await service.generateAiRecommendations(
      {
        userId: 'user-id',
        diagnostics: [
          'client needs a bespoke implementation path внедренческая настройка',
        ],
      },
      [candidate],
      [
        'client needs a bespoke implementation path',
        'внедренческая настройка',
      ].join(' '),
    );

    expect(result.recommendations[0]).toMatchObject({
      serviceId: 'semantic-service-id',
      score: 6,
      diagnosticSignals: ['ai_generated', 'ai_semantic_match'],
    });
  });

  it('does not expose an unsupported diagnosis from the AI rationale', async () => {
    const candidate = {
      id: 'crm-service-id',
      name: 'CRM audit',
      description: 'CRM quality audit',
      type: ServiceType.Service,
      skills: ['CRM'],
      category: null,
    } as unknown as ServiceCandidate;
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"serviceId":"crm-service-id","priority":"medium","rationale":"У кли' +
        'ента просадка конверсии.","diagnosticSignals":["conversion_drop"]}]}',
    });

    const result = await service.generateAiRecommendations(
      { userId: 'user-id', diagnostics: ['CRM'] },
      [candidate],
      'crm',
    );

    expect(result.recommendations[0].rationale).not.toContain(
      'просадка конверсии',
    );
    expect(result.recommendations[0].diagnosticSignals).not.toContain(
      'conversion_drop',
    );
  });

  it('rejects AI-only semantic recommendations without service-specific evidence', async () => {
    const candidate = {
      id: 'unrelated-service-id',
      name: 'Юридический документ',
      description: 'Договор и правовая проверка',
      type: ServiceType.Document,
      skills: ['legal'],
      category: null,
    } as unknown as ServiceCandidate;
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"serviceId":"unrelated-service-id","priority":"medium","rationale":' +
        '"Подходит, потому что закрывает описанный клиентом сценарий.","diagnosticSignals":["cust' +
        'om_fit"]}]}',
    });

    const result = await service.generateAiRecommendations(
      {
        userId: 'user-id',
        diagnostics: ['client needs CRM implementation'],
      },
      [candidate],
      'client needs CRM implementation',
    );

    expect(result.recommendations).toEqual([]);
  });

  it('resolves AI recommendation output to packageId for package candidates', async () => {
    const candidate = {
      id: 'package-id',
      serviceId: null,
      packageId: 'package-id',
      name: 'CRM Package',
      description: 'CRM package with setup and telephony',
      type: 'Пакет услуг',
      skills: ['CRM', 'telephony'],
      category: { name: 'Пакет услуг' },
      coveredServiceIds: ['service-id'],
    } as unknown as ServiceCandidate;
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"serviceId":"package-id","priority":"urgent","rationale":"Best pack' +
        'age fit","diagnosticSignals":["crm_quality"]}]}',
    });

    const result = await service.generateAiRecommendations(
      {
        userId: 'user-id',
        diagnostics: ['CRM data quality'],
      },
      [candidate],
      'crm data quality',
    );

    expect(result.recommendations[0]).toMatchObject({
      serviceId: null,
      packageId: 'package-id',
      coveredServiceIds: ['service-id'],
    });
    expect(result.recommendations[0].rationale).toMatch(/[а-яё]/i);
  });

  it('filters AI recommendations that do not match diagnostics locally', async () => {
    const relevantCandidate = {
      id: 'crm-service-id',
      name: 'CRM Quality',
      description: 'CRM data cleanup and status audit',
      type: ServiceType.Service,
      skills: ['CRM'],
      category: null,
    } as unknown as ServiceCandidate;
    const unrelatedCandidate = {
      id: 'unrelated-service-id',
      name: 'Legal document',
      description: 'Contract template and legal review',
      type: ServiceType.Document,
      skills: ['legal'],
      category: null,
    } as unknown as ServiceCandidate;
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"serviceId":"crm-service-id","priority":"medium","rationale":"Подхо' +
        'дит для CRM","diagnosticSignals":["crm_quality"]},{"serviceId":"unrelated-service-id","p' +
        'riority":"medium","rationale":"Looks good","diagnosticSignals":["crm_quality"]}]}',
    });

    const result = await service.generateAiRecommendations(
      {
        userId: 'user-id',
        diagnostics: ['CRM data quality'],
      },
      [relevantCandidate, unrelatedCandidate],
      'crm data quality',
    );

    expect(result.recommendations.map((item) => item.serviceId)).toEqual([
      'crm-service-id',
    ]);
  });

  it('ignores AI service ids outside the catalog slice sent to the model', async () => {
    const candidates = Array.from({ length: 501 }, (_, index) => ({
      id: `crm-service-${index}`,
      name: `CRM setup ${index}`,
      description: 'CRM data quality and setup',
      type: ServiceType.Service,
      skills: ['CRM'],
      category: null,
    })) as unknown as ServiceCandidate[];
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"serviceId":"crm-service-500","priority":"medium","rationale":"Подх' +
        'одит для CRM","diagnosticSignals":["crm_quality"]}]}',
    });

    const result = await service.generateAiRecommendations(
      {
        userId: 'user-id',
        diagnostics: ['CRM data quality'],
      },
      candidates,
      'crm data quality',
    );

    expect(result.recommendations).toEqual([]);
  });

  it('returns a Russian plain-text summary for the recommendation set', async () => {
    const candidate = {
      id: 'crm-audit-id',
      name: 'CRM-аудит',
      description: 'Проверка качества данных CRM',
      type: ServiceType.Service,
      skills: ['CRM'],
      category: null,
    } as ServiceCandidate;
    const summary = [
      'В соответствии с предоставленной вами информацией',
      'специализированный AI-ассистент рекомендует CRM-аудит.',
      'Этот инструмент поможет улучшить качество данных CRM',
      'с учётом ответов анкеты.',
    ].join(' ');
    llmProxy.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        summary,
        recommendations: [
          {
            serviceId: 'crm-audit-id',
            priority: 'medium',
            rationale: 'Подходит для проверки CRM.',
            diagnosticSignals: ['crm_quality'],
          },
        ],
      }),
    });

    const result = await service.generateAiRecommendations(
      { userId: 'user-id', diagnostics: ['Нужно проверить качество CRM'] },
      [candidate],
      'нужно проверить качество crm',
    );

    expect(result.summary).toBe(summary);
    expect(result.summary).not.toMatch(/[\n*_`#]/);
    expect(result.summary).not.toMatch(/приоритет|срочн|priority/i);

    const request = llmProxy.chat.mock.calls[0][0];
    const payload = JSON.parse(request.messages[1].content);
    expect(payload.instruction).toContain('2–4 предложений');
    expect(payload.instruction).toContain(
      'Не упоминай в summary поле priority',
    );
  });

  it.each([
    {
      clientProfile: { productStage: 'new' },
      expectedSummary: [
        'На основании заполненной анкеты AI сформировал проект вашего отдела продаж.',
        'В него вошли инструменты, документы, специалисты и AI-модули,',
        'которые необходимы для достижения ваших целей.',
        'Каждая рекомендация основана на параметрах вашего бизнеса',
        'и может быть подключена прямо из платформы.',
      ].join(' '),
    },
    {
      clientProfile: { productStage: 'existing' },
      expectedSummary: [
        'На основании ваших ответов AI проанализировал текущую организацию отдела продаж',
        'и определил, какие изменения помогут повысить его эффективность.',
        'Ниже представлены решения, которые рекомендуется внедрить именно вашей компании.',
        'Каждая рекомендация направлена на устранение выявленных ограничений,',
        'автоматизацию процессов и достижение поставленных бизнес-целей.',
      ].join(' '),
    },
    {
      clientProfile: {
        productStage: 'existing',
        targetResult: 'Построить отдел продаж с нуля',
      },
      expectedSummary: [
        'На основании заполненной анкеты AI сформировал проект вашего отдела продаж.',
        'В него вошли инструменты, документы, специалисты и AI-модули,',
        'которые необходимы для достижения ваших целей.',
        'Каждая рекомендация основана на параметрах вашего бизнеса',
        'и может быть подключена прямо из платформы.',
      ].join(' '),
    },
  ])(
    'uses the approved preamble for $clientProfile',
    async ({ clientProfile, expectedSummary }) => {
      const candidate = {
        id: 'crm-audit-id',
        name: 'CRM-аудит',
        description: 'Проверка качества данных CRM',
        type: ServiceType.Service,
        skills: ['CRM'],
        category: null,
      } as ServiceCandidate;
      llmProxy.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          summary:
            'Модель попыталась заменить утверждённый текст. Это второе предложение.',
          recommendations: [
            {
              serviceId: 'crm-audit-id',
              rationale: 'Подходит для проверки CRM.',
            },
          ],
        }),
      });

      const result = await service.generateAiRecommendations(
        { userId: 'user-id', clientProfile, diagnostics: ['качество CRM'] },
        [candidate],
        'качество crm',
      );

      expect(result.summary).toBe(expectedSummary);
      expect(result.summary).not.toMatch(/приоритет|срочн|priority/i);

      const request = llmProxy.chat.mock.calls[0][0];
      const payload = JSON.parse(request.messages[1].content);
      expect(payload.summaryPreamble).toBe(expectedSummary);
      expect(payload.instruction).toContain(
        'поле summary должно дословно совпадать с ним',
      );
    },
  );

  it('removes Markdown noise from an otherwise valid summary', async () => {
    const candidate = {
      id: 'crm-cleanup-id',
      name: 'Очистка CRM',
      description: 'Очистка данных CRM',
      type: ServiceType.Service,
      skills: ['CRM'],
      category: null,
    } as ServiceCandidate;
    llmProxy.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        summary: [
          '**AI-ассистент рекомендует очистку CRM.**',
          '## Инструмент соответствует указанной в анкете',
          'задаче по качеству данных.',
        ].join('\n\n'),
        recommendations: [
          {
            serviceId: 'crm-cleanup-id',
            rationale: 'Подходит для CRM.',
          },
        ],
      }),
    });

    const result = await service.generateAiRecommendations(
      { userId: 'user-id', diagnostics: ['качество CRM'] },
      [candidate],
      'качество crm',
    );

    expect(result.summary).toBe(
      'AI-ассистент рекомендует очистку CRM. Инструмент соответствует указанной в анкете задаче по качеству данных.',
    );
  });

  it.each([
    'AI-ассистент считает CRM-аудит срочной рекомендацией. Этот инструмент соответствует ответам анкеты.',
    'AI-ассистент рекомендует CRM-аудит из-за снижения конверсии на 30%. Этот инструмент соответствует ответам анкеты.',
  ])(
    'replaces an unsafe summary with a neutral fallback: %s',
    async (summary) => {
      const candidate = {
        id: 'crm-audit-id',
        name: 'CRM-аудит',
        description: 'Проверка качества CRM',
        type: ServiceType.Service,
        skills: ['CRM'],
        category: null,
      } as ServiceCandidate;
      llmProxy.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          summary,
          recommendations: [
            {
              serviceId: 'crm-audit-id',
              rationale: 'Подходит для CRM.',
            },
          ],
        }),
      });

      const result = await service.generateAiRecommendations(
        { userId: 'user-id', diagnostics: ['CRM'] },
        [candidate],
        'crm',
      );

      expect(result.summary).toContain('предоставленной вами информацией');
      expect(result.summary).not.toMatch(/срочн|приоритет|30%/i);
    },
  );

  it('does not declare user diagnostics as no_pii for proxy calls', async () => {
    llmProxy.chat.mockResolvedValueOnce({ content: '{"recommendations":[]}' });

    await service.generateAiRecommendations(
      {
        userId: 'user-id',
        clientProfile: { contact: 'client@example.com' },
        diagnostics: ['Call +7 999 111 22 33'],
      },
      [],
      'call client',
    );

    expect(llmProxy.chat).toHaveBeenCalledWith(
      expect.not.objectContaining({ declaredDataClass: expect.anything() }),
    );
  });
});
