import { Redis } from "@upstash/redis";

import { getRedisConfig } from "@/src/config/env";

export type TokenStore = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
};

class MemoryTokenStore implements TokenStore {
  private values = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string) {
    const hit = this.values.get(key);
    if (!hit || hit.expiresAt <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return hit.value;
  }

  async set(key: string, value: string, ttlSeconds: number) {
    this.values.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
}

class UpstashTokenStore implements TokenStore {
  private client: Redis;

  constructor(config: { url: string; token: string }) {
    this.client = new Redis(config);
  }

  async get(key: string) {
    const value = await this.client.get<string>(key);
    return value ?? undefined;
  }

  async set(key: string, value: string, ttlSeconds: number) {
    await this.client.set(key, value, { ex: ttlSeconds });
  }
}

const memoryStore = new MemoryTokenStore();
let cachedStore: TokenStore | undefined;

export function getTokenStore() {
  if (cachedStore) {
    return cachedStore;
  }

  const redis = getRedisConfig();
  cachedStore = redis ? new UpstashTokenStore(redis) : memoryStore;
  return cachedStore;
}
