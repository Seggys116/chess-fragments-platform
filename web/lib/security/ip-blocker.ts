import { redis } from '@/lib/redis';

const FAILED_ATTEMPTS_KEY_PREFIX = 'failed_attempts:';
const BLOCKED_IP_KEY_PREFIX = 'blocked:';
const FAILED_ATTEMPTS_WINDOW = 300; // 5 minutes in seconds
const MAX_FAILED_ATTEMPTS = 5; // Max attempts before blocking
const BLOCK_DURATION = 3600; // 1 hour in seconds

export async function trackFailedAttempt(ip: string): Promise<boolean> {
  if (!redis) return false;

  const key = `${FAILED_ATTEMPTS_KEY_PREFIX}${ip}`;

  try {
    // Increment failed attempts
    const attempts = await redis.incr(key);

    if (attempts === 1) {
      await redis.expire(key, FAILED_ATTEMPTS_WINDOW);
    }

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      await blockIp(ip, BLOCK_DURATION);
      return true;
    }

    return false;
  } catch (error) {
    console.error('Failed to track failed attempt:', error);
    return false;
  }
}

export async function blockIp(ip: string, durationSeconds: number): Promise<void> {
  if (!redis) return;

  const key = `${BLOCKED_IP_KEY_PREFIX}${ip}`;

  try {
    await redis.setex(key, durationSeconds, JSON.stringify({
      blockedAt: new Date().toISOString(),
      reason: 'Too many failed attempts',
      duration: durationSeconds
    }));

    console.warn(`IP BLOCKED: ${ip} for ${durationSeconds} seconds`);
  } catch (error) {
    console.error('Failed to block IP:', error);
  }
}

export async function isIpBlocked(ip: string): Promise<boolean> {
  if (!redis) return false;

  const key = `${BLOCKED_IP_KEY_PREFIX}${ip}`;

  try {
    const blocked = await redis.get(key);
    return blocked !== null;
  } catch (error) {
    console.error('Failed to check IP block:', error);
    return false;
  }
}

export async function clearFailedAttempts(ip: string): Promise<void> {
  if (!redis) return;

  const key = `${FAILED_ATTEMPTS_KEY_PREFIX}${ip}`;

  try {
    await redis.del(key);
  } catch (error) {
    console.error('Failed to clear failed attempts:', error);
  }
}

export async function getRemainingBlockTime(ip: string): Promise<number | null> {
  if (!redis) return null;

  const key = `${BLOCKED_IP_KEY_PREFIX}${ip}`;

  try {
    const ttl = await redis.get(key);
    if (!ttl) return null;

    const remaining = await redis.eval(
      `return redis.call("TTL", KEYS[1])`,
      1,
      key
    );

    return remaining as number;
  } catch (error) {
    console.error('Failed to get remaining block time:', error);
    return null;
  }
}