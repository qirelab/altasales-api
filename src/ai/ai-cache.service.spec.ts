import { AiCacheService } from './ai-cache.service';

describe('AiCacheService', () => {
  const config = (values: Record<string, string | number> = {}) => ({
    get: jest.fn((key: string) => values[key]),
  }) as any;

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('evicts oldest entry when max size is reached', async () => {
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now++);
    const service = new AiCacheService(config({ AI_CACHE_MAX_ENTRIES: 2 }));

    service.write(service.buildKey('ns', 'a'), 'val-a', 60_000);
    service.write(service.buildKey('ns', 'b'), 'val-b', 60_000);
    service.write(service.buildKey('ns', 'c'), 'val-c', 60_000);

    expect(service.read(service.buildKey('ns', 'a'))).toBeUndefined();
    expect(service.read(service.buildKey('ns', 'b'))).toBe('val-b');
    expect(service.read(service.buildKey('ns', 'c'))).toBe('val-c');
  });

  it('evicts least recently used entry when max size is reached', async () => {
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now++);
    const service = new AiCacheService(config({ AI_CACHE_MAX_ENTRIES: 2 }));
    const keyA = service.buildKey('ns', 'a');
    const keyB = service.buildKey('ns', 'b');
    const keyC = service.buildKey('ns', 'c');

    service.write(keyA, 'val-a', 60_000);
    service.write(keyB, 'val-b', 60_000);
    service.read(keyA);
    service.write(keyC, 'val-c', 60_000);

    expect(service.read(keyA)).toBe('val-a');
    expect(service.read(keyB)).toBeUndefined();
    expect(service.read(keyC)).toBe('val-c');
  });

  it('delete removes entry', () => {
    const service = new AiCacheService();
    const key = service.buildKey('ns', 'x');

    service.write(key, 'val', 60_000);
    service.delete(key);

    expect(service.read(key)).toBeUndefined();
  });

  it('produces stable keys for nested objects', () => {
    const service = new AiCacheService();
    const key1 = service.buildKey('ns', { z: { b: 2, a: 1 }, y: [3, 4] });
    const key2 = service.buildKey('ns', { y: [3, 4], z: { a: 1, b: 2 } });

    expect(key1).toBe(key2);
  });
});
