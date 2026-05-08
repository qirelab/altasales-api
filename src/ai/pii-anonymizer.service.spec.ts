import { PiiAnonymizerService } from './pii-anonymizer.service';

describe('PiiAnonymizerService', () => {
  let service: PiiAnonymizerService;

  beforeEach(() => {
    service = new PiiAnonymizerService();
  });

  it('detects email', () => {
    const result = service.scanText('Contact user@example.com please');

    expect(result.hasPii).toBe(true);
    expect(result.stats.email).toBe(1);
  });

  it('detects RU phone', () => {
    const result = service.scanText('Call +7 (999) 123-45-67 today');

    expect(result.hasPii).toBe(true);
    expect(result.stats.phone).toBe(1);
  });

  it('detects INN', () => {
    const result = service.scanText('ИНН 7707083893 and 500100732259');

    expect(result.hasPii).toBe(true);
    expect(result.stats.inn).toBe(2);
  });

  it('returns no PII for clean text', () => {
    const result = service.scanText(
      'Public product summary without personal data',
    );

    expect(result.hasPii).toBe(false);
    expect(result.stats).toEqual({ email: 0, phone: 0, inn: 0 });
  });

  it('does not expose original values in scan result', () => {
    const result = service.scanText(
      'user@example.com +7 999 123-45-67 7707083893',
    );
    const serializedResult = JSON.stringify(result);

    expect(serializedResult).not.toContain('user@example.com');
    expect(serializedResult).not.toContain('+7 999 123-45-67');
    expect(serializedResult).not.toContain('7707083893');
  });
});
