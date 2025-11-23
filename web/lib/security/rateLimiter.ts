// Lazy load Redis to avoid Edge Runtime issues
let redis: any = null;
async function getRedis() {
  if (!redis) {
    try {
      const redisModule = await import('../redis');
      redis = redisModule.redis;
    } catch (error) {
      console.warn('Redis not available:', error);
    }
  }
  return redis;
}

interface RateLimitOptions {
  identifier: string; // IP address or user ID
  endpoint?: string; // Optional endpoint for specific limits
  maxRequests: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining?: number;
  retryAfter?: number;
}

export async function globalRateLimit({
  identifier,
  endpoint = 'global',
  maxRequests,
  windowMs,
}: RateLimitOptions): Promise<RateLimitResult> {
  const redis = await getRedis();

  if (!redis) {
    // If Redis is not available, allow the request
    console.warn('Redis not available for rate limiting');
    return { allowed: true, remaining: maxRequests };
  }

  const now = Date.now();
  const windowStart = now - windowMs;

  const key = `ratelimit:${endpoint}:${identifier}`;

  try {
    // Start a Redis transaction
    const multi = redis.multi();

    // Remove old entries outside the window
    multi.zremrangebyscore(key, '-inf', windowStart);

    // Count requests in the current window
    multi.zcard(key);

    // Add current request with timestamp as score
    multi.zadd(key, now, `${now}-${Math.random()}`);

    multi.expire(key, Math.ceil(windowMs / 1000));

    // Execute transaction
    const results = await multi.exec();

    if (!results) {
      return { allowed: true, remaining: maxRequests };
    }

    const count = results[1][1] as number;

    if (count >= maxRequests) {
      // Rate limit exceeded, remove the request we just added
      await redis.zrem(key, `${now}-${Math.random()}`);

      const oldestRequest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const retryAfter = oldestRequest.length > 1
        ? Math.max(0, windowMs - (now - parseInt(oldestRequest[1])))
        : windowMs;

      return {
        allowed: false,
        remaining: 0,
        retryAfter,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - count - 1),
    };
  } catch (error) {
    console.error('Rate limit check failed:', error);
    // On error, allow the request but log it
    return { allowed: true, remaining: maxRequests };
  }
}

export async function userRateLimit(
  userId: string,
  operation: 'upload' | 'update' | 'create',
  customLimits?: { maxRequests: number; windowMs: number }
): Promise<RateLimitResult> {
  const limits = customLimits || {
    upload: { maxRequests: 1, windowMs: 3600000 }, // 1 per hour
    update: { maxRequests: 5, windowMs: 3600000 }, // 5 per hour
    create: { maxRequests: 10, windowMs: 60000 }, // 10 per minute
  }[operation];

  return globalRateLimit({
    identifier: `user:${userId}`,
    endpoint: operation,
    maxRequests: limits.maxRequests,
    windowMs: limits.windowMs,
  });
}

export async function ipRateLimit(
  ip: string,
  endpoint: string,
  maxRequests = 100,
  windowMs = 60000
): Promise<RateLimitResult> {
  return globalRateLimit({
    identifier: `ip:${ip}`,
    endpoint,
    maxRequests,
    windowMs,
  });
}

export async function isBlocked(identifier: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  try {
    const blocked = await redis.get(`blocked:${identifier}`);
    return blocked === 'true';
  } catch (error) {
    console.error('Block check failed:', error);
    return false;
  }
}

export async function blockIdentifier(
  identifier: string,
  durationMs: number,
  reason: string
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    const key = `blocked:${identifier}`;
    const logKey = `blocked:log:${identifier}`;

    await redis.setex(key, Math.ceil(durationMs / 1000), 'true');
    await redis.setex(
      logKey,
      Math.ceil(durationMs / 1000),
      JSON.stringify({
        reason,
        blockedAt: new Date().toISOString(),
        duration: durationMs,
      })
    );
  } catch (error) {
    console.error('Failed to block identifier:', error);
  }
}

export async function distributedRateLimit(
  identifier: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  const redis = await getRedis();

  if (!redis) {
    return { allowed: true, remaining: maxRequests };
  }

  const now = Date.now();
  const key = `distributed:${identifier}`;

  try {
    // Use Lua script for atomic operation
    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local max_requests = tonumber(ARGV[3])
      local window_start = now - window

      -- Remove old entries
      redis.call('zremrangebyscore', key, '-inf', window_start)

      -- Count current entries
      local current_count = redis.call('zcard', key)

      if current_count < max_requests then
        -- Add new entry
        redis.call('zadd', key, now, now .. ':' .. math.random())
        redis.call('expire', key, window / 1000)
        return {1, max_requests - current_count - 1}
      else
        -- Get oldest entry for retry calculation
        local oldest = redis.call('zrange', key, 0, 0, 'WITHSCORES')
        local retry_after = window
        if #oldest > 0 then
          retry_after = window - (now - tonumber(oldest[2]))
        end
        return {0, 0, retry_after}
      end
    `;

    // Execute the Lua script
    const result = await redis.eval(
      luaScript,
      1,
      key,
      now,
      windowMs,
      maxRequests
    ) as number[];

    return {
      allowed: result[0] === 1,
      remaining: result[1],
      retryAfter: result[2],
    };
  } catch (error) {
    console.error('Distributed rate limit failed:', error);
    return { allowed: true, remaining: maxRequests };
  }
}