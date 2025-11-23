import { createClient } from 'redis';

class RedisClientWrapper {
  private client: ReturnType<typeof createClient> | null = null;
  private isConnecting = false;
  private connectionPromise: Promise<void> | null = null;

  async getClient() {
    if (!this.client) {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
      });

      this.client.on('error', (err) => console.error('Redis Client Error', err));
    }

    if (!this.client.isOpen && !this.isConnecting) {
      this.isConnecting = true;
      this.connectionPromise = this.client.connect()
        .then(() => {
          this.isConnecting = false;
        })
        .catch((err) => {
          this.isConnecting = false;
          console.error('Failed to connect to Redis:', err);
          throw err;
        });
    }

    if (this.connectionPromise) {
      await this.connectionPromise;
    }

    return this.client;
  }

  // Proxy methods to ensure connection
  async multi() {
    const client = await this.getClient();
    return client.multi();
  }

  async get(key: string) {
    const client = await this.getClient();
    return client.get(key);
  }

  async set(key: string, value: string, options?: any) {
    const client = await this.getClient();
    return client.set(key, value, options);
  }

  async setex(key: string, seconds: number, value: string) {
    const client = await this.getClient();
    return client.setEx(key, seconds, value);
  }

  async del(key: string) {
    const client = await this.getClient();
    return client.del(key);
  }

  async expire(key: string, seconds: number) {
    const client = await this.getClient();
    return client.expire(key, seconds);
  }

  async zadd(key: string, score: number, member: string) {
    const client = await this.getClient();
    return client.zAdd(key, { score, value: member });
  }

  async zremrangebyscore(key: string, min: string | number, max: string | number) {
    const client = await this.getClient();
    return client.zRemRangeByScore(key, min, max);
  }

  async zcard(key: string) {
    const client = await this.getClient();
    return client.zCard(key);
  }

  async zrange(key: string, start: number, stop: number, options?: string) {
    const client = await this.getClient();
    if (options === 'WITHSCORES') {
      return client.zRangeWithScores(key, start, stop);
    }
    return client.zRange(key, start, stop);
  }

  async zrem(key: string, member: string) {
    const client = await this.getClient();
    return client.zRem(key, member);
  }

  async keys(pattern: string) {
    const client = await this.getClient();
    return client.keys(pattern);
  }

  async hgetall(key: string) {
    const client = await this.getClient();
    return client.hGetAll(key);
  }

  async hset(key: string, field: string, value: string) {
    const client = await this.getClient();
    return client.hSet(key, field, value);
  }

  async incr(key: string) {
    const client = await this.getClient();
    return client.incr(key);
  }

  async eval(script: string, numKeys: number, ...args: any[]) {
    const client = await this.getClient();
    return client.eval(script, {
      keys: args.slice(0, numKeys),
      arguments: args.slice(numKeys).map(String),
    });
  }
}

const redisWrapper = new RedisClientWrapper();

// Legacy client for backward compatibility
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

let isConnected = false;

async function ensureConnected() {
  if (!isConnected) {
    try {
      await redisClient.connect();
      isConnected = true;
    } catch (err) {
      console.error('Failed to connect to Redis:', err);
      throw err;
    }
  }
}

export async function checkRateLimit(
  userId: string,
  ip: string,
  limitPerHour: number = 1,
  hours: number = 1
): Promise<{ allowed: boolean; retryAfter?: number }> {
  await ensureConnected();

  const userKey = `ratelimit:user:${userId}`;
  const ipKey = `ratelimit:ip:${ip}`;

  const now = Date.now();
  const windowMs = hours * 3600000; // hours * milliseconds per hour
  const windowAgo = now - windowMs;

  await redisClient.zRemRangeByScore(userKey, 0, windowAgo);
  const userCount = await redisClient.zCard(userKey);

  if (userCount >= limitPerHour) {
    const oldest = await redisClient.zRange(userKey, 0, 0);
    if (oldest.length > 0) {
      const retryAfter = Math.ceil((parseInt(oldest[0]) + windowMs - now) / 1000);
      return { allowed: false, retryAfter };
    }
    return { allowed: false };
  }

  const minuteAgo = now - 60000;
  await redisClient.zRemRangeByScore(ipKey, 0, minuteAgo);
  const ipCount = await redisClient.zCard(ipKey);

  if (ipCount >= 100) {
    return { allowed: false };
  }

  // Add to rate limit sets
  await redisClient.zAdd(userKey, { score: now, value: now.toString() });
  await redisClient.zAdd(ipKey, { score: now, value: now.toString() });
  await redisClient.expire(userKey, hours * 3600); // Expire after the configured window
  await redisClient.expire(ipKey, 60);

  return { allowed: true };
}

export async function checkCodeDuplicate(codeHash: string): Promise<boolean> {
  await ensureConnected();
  const exists = await redisClient.get(`code:${codeHash}`);
  return exists !== null;
}

export async function markCodeAsUploaded(codeHash: string): Promise<void> {
  await ensureConnected();
  await redisClient.set(`code:${codeHash}`, '1', { EX: 3600 * 24 * 30 }); // 30 days
}

// Export the wrapper as redis for use in other modules
export { redisWrapper as redis };
export default redisClient;