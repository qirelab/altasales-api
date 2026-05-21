import { DataClass } from './enums/data-class.enum';
import { AnonymizerProvider } from './interfaces/anonymizer-provider.interface';
import { LlmMessage } from './interfaces/llm-message.interface';
import { PiiAnonymizerService } from './pii-anonymizer.service';

describe('PiiAnonymizerService', () => {
  let provider: { anonymize: jest.Mock };
  let service: PiiAnonymizerService;

  const messages: LlmMessage[] = [
    { role: 'user', content: 'Contact user@example.com please' },
  ];

  beforeEach(() => {
    provider = {
      anonymize: jest.fn(),
    };
    service = new PiiAnonymizerService(provider as AnonymizerProvider);
  });

  it('detects structured PII without exposing values', () => {
    const result = service.scanText(
      'Contact user@example.com, +7 (999) 123-45-67, ИНН 7707083893, СНИЛС 123-456-789 00, passport 4510 123456, card 4111 1111 1111 1111, дата рождения 01.02.1990',
    );
    const serializedResult = JSON.stringify(result);

    expect(result.hasPii).toBe(true);
    expect(result.stats).toMatchObject({
      email: 1,
      phone: 1,
      inn: 1,
      snils: 1,
      passport: 1,
      bank_card: 1,
      birth_date: 1,
    });
    expect(serializedResult).not.toContain('user@example.com');
    expect(serializedResult).not.toContain('+7 (999) 123-45-67');
    expect(serializedResult).not.toContain('7707083893');
  });

  it('returns no PII for clean text', () => {
    const result = service.scanText(
      'Public product summary without personal data',
    );

    expect(result.hasPii).toBe(false);
  });

  it('validates anonymizer JSON and returns anonymized data class', async () => {
    provider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: [{ role: 'user', content: 'Contact {{PII_EMAIL_0001}}' }],
        entities: [
          {
            placeholder: '{{PII_EMAIL_0001}}',
            type: 'email',
            description: 'email address',
          },
        ],
        placeholderMap: {
          '{{PII_EMAIL_0001}}': 'user@example.com',
        },
        stats: { email: 1 },
      }),
    );

    const result = await service.anonymizeMessages(messages);

    expect(result.dataClass).toBe(DataClass.AnonymizedPii);
    expect(result.messages[0].content).toBe('Contact {{PII_EMAIL_0001}}');
    expect(result.semanticPlaceholderDescriptions).toEqual({
      '{{PII_EMAIL_0001}}': 'email address',
    });
  });

  it('returns no_pii when anonymizer finds no entities', async () => {
    const cleanMessages: LlmMessage[] = [
      { role: 'user', content: 'Summarize public information' },
    ];
    provider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: cleanMessages,
        entities: [],
        placeholderMap: {},
        stats: {},
      }),
    );

    const result = await service.anonymizeMessages(cleanMessages);

    expect(result.dataClass).toBe(DataClass.NoPii);
  });

  it('returns high_sensitive for high-sensitive entities', async () => {
    provider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: [{ role: 'user', content: 'SNILS {{PII_SNILS_0001}}' }],
        entities: [
          {
            placeholder: '{{PII_SNILS_0001}}',
            type: 'snils',
            description: 'SNILS',
          },
        ],
        placeholderMap: {
          '{{PII_SNILS_0001}}': '123-456-789 00',
        },
        stats: { snils: 1 },
      }),
    );

    const result = await service.anonymizeMessages(messages);

    expect(result.dataClass).toBe(DataClass.HighSensitive);
  });

  it('fails closed on malformed JSON', async () => {
    provider.anonymize.mockResolvedValueOnce('not-json');

    await expect(service.anonymizeMessages(messages)).rejects.toThrow(
      'validation_error',
    );
    expect(provider.anonymize).toHaveBeenCalledTimes(1);
  });

  it('fails closed when message count changes', async () => {
    provider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: [],
        entities: [],
        placeholderMap: {},
        stats: {},
      }),
    );

    await expect(service.anonymizeMessages(messages)).rejects.toThrow(
      'validation_error',
    );
  });

  it('fails closed when message role changes', async () => {
    provider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: [{ role: 'assistant', content: 'Contact {{PII_EMAIL_0001}}' }],
        entities: [],
        placeholderMap: {},
        stats: {},
      }),
    );

    await expect(service.anonymizeMessages(messages)).rejects.toThrow(
      'validation_error',
    );
  });

  it('fails closed on unsupported entity type', async () => {
    provider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: [{ role: 'user', content: '{{PII_SECRET_0001}}' }],
        entities: [
          {
            placeholder: '{{PII_SECRET_0001}}',
            type: 'secret',
            description: 'unsupported',
          },
        ],
        placeholderMap: {
          '{{PII_SECRET_0001}}': 'raw',
        },
        stats: { secret: 1 },
      }),
    );

    await expect(service.anonymizeMessages(messages)).rejects.toThrow(
      'validation_error',
    );
  });

  it('fails closed when raw map values remain in anonymized messages', async () => {
    provider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: [{ role: 'user', content: 'Contact user@example.com' }],
        entities: [
          {
            placeholder: '{{PII_EMAIL_0001}}',
            type: 'email',
            description: 'email address',
          },
        ],
        placeholderMap: {
          '{{PII_EMAIL_0001}}': 'user@example.com',
        },
        stats: { email: 1 },
      }),
    );

    await expect(service.anonymizeMessages(messages)).rejects.toThrow(
      'validation_error',
    );
  });

  it('fails closed when post-anonymization scan catches structured PII', async () => {
    provider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: [{ role: 'user', content: 'Contact leak@example.com' }],
        entities: [],
        placeholderMap: {},
        stats: {},
      }),
    );

    await expect(service.anonymizeMessages(messages)).rejects.toThrow(
      'validation_error',
    );
  });

  it('restores placeholders deterministically', () => {
    const result = service.restoreText('Email: {{PII_EMAIL_0001}}', {
      '{{PII_EMAIL_0001}}': 'user@example.com',
    });

    expect(result.content).toBe('Email: user@example.com');
    expect(result.restoredCount).toBe(1);
    expect(result.unresolvedPlaceholders).toEqual([]);
  });

  it('reports unresolved placeholders safely', () => {
    const result = service.restoreText('Email: {{PII_EMAIL_0002}}', {
      '{{PII_EMAIL_0001}}': 'user@example.com',
    });

    expect(result.content).toBe('Email: {{PII_EMAIL_0002}}');
    expect(result.unresolvedPlaceholders).toEqual(['{{PII_EMAIL_0002}}']);
  });
});
