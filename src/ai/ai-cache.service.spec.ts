import { AiCacheService } from './ai-cache.service';

describe('AiCacheService', () => {
  it('returns cached value for stable equivalent payloads', async () => {
    const service = new AiCacheService();
    const factory = jest.fn().mockResolvedValue({ ok: true });

    const first = await service.remember(
      'test',
      { b: 2, a: 1 },
      factory,
      1000,
    );
    const second = await service.remember(
      'test',
      { a: 1, b: 2 },
      factory,
      1000,
    );

    expect(first.hit).toBe(false);
    expect(second.hit).toBe(true);
    expect(second.value).toEqual({ ok: true });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('expires entries by ttl', async () => {
    const service = new AiCacheService();
    const key = service.buildKey('test', { value: 1 });

    service.write(key, 'value', -1);

    expect(service.read(key)).toBeUndefined();
  });
});
