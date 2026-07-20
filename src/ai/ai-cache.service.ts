import { createHash } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type CacheEntry<T> = {
  value: T;
  createdAt: number;
  accessedAt: number;
  expiresAt: number;
};

export type CacheLookup<T> = {
  key: string;
  hit: boolean;
  value: T;
};

@Injectable()
export class AiCacheService {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  constructor(
    @Optional()
    private readonly configService?: ConfigService,
  ) {
    this.defaultTtlMs = this.getPositiveNumber('AI_CACHE_TTL_SECONDS', 60 * 60) * 1000;
    this.maxEntries = this.getPositiveNumber('AI_CACHE_MAX_ENTRIES', 1000);
  }

  async remember<T>(
    namespace: string,
    payload: unknown,
    factory: () => Promise<T>,
    ttlMs = this.defaultTtlMs,
  ): Promise<CacheLookup<T>> {
    const key = this.buildKey(namespace, payload);
    const cached = this.read<T>(key);

    if (cached !== undefined) {
      return { key, hit: true, value: cached };
    }

    const value = await factory();
    this.write(key, value, ttlMs);

    return { key, hit: false, value };
  }

  read<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;

    if (!entry) return undefined;

    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    entry.accessedAt = Date.now();
    return entry.value;
  }

  write<T>(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    if (!this.store.has(key)) {
      this.evictIfNeeded();
    }
    const now = Date.now();
    this.store.set(key, {
      value,
      createdAt: now,
      accessedAt: now,
      expiresAt: now + ttlMs,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  buildKey(namespace: string, payload: unknown): string {
    const hash = createHash('sha256')
      .update(this.stableStringify(payload))
      .digest('hex');

    return `${namespace}:${hash}`;
  }

  private evictIfNeeded(): void {
    if (this.store.size < this.maxEntries) return;

    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt < now) {
        this.store.delete(key);
      }
    }

    if (this.store.size >= this.maxEntries) {
      const evictionCount = Math.max(1, Math.ceil(this.maxEntries * 0.05));
      const lruKeys = Array.from(this.store.entries())
        .sort(([, a], [, b]) => a.accessedAt - b.accessedAt)
        .slice(0, evictionCount)
        .map(([key]) => key);

      lruKeys.forEach((key) => this.store.delete(key));
    }
  }

  private getPositiveNumber(key: string, fallback: number): number {
    const raw = this.configService?.get<string | number>(key);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  // Handles plain JSON AI payloads; Date, Map and Set are intentionally out of scope.
  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }

    const objectValue = value as Record<string, unknown>;

    return `{${Object.keys(objectValue)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${this.stableStringify(objectValue[key])}`,
      )
      .join(',')}}`;
  }
}
