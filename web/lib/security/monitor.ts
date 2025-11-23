import { redis } from '../redis';
import { IP_BLOCKING, MONITORING_CONFIG, LOGGING_CONFIG } from './config';

interface SecurityEvent {
  type: 'rate_limit' | 'auth_failure' | 'validation_error' | 'blocked_request' | 'suspicious_activity';
  ip: string;
  userId?: string;
  endpoint: string;
  details: Record<string, any>;
  timestamp: Date;
}

interface MetricsData {
  requests: number;
  errors: number;
  rateLimitHits: number;
  avgResponseTime: number;
  activeUsers: Set<string>;
  securityEvents: SecurityEvent[];
}

class SecurityMonitor {
  private metrics: Map<string, MetricsData> = new Map();
  private currentHour: number;

  constructor() {
    this.currentHour = new Date().getHours();
    this.resetHourlyMetrics();

    // Reset metrics every hour
    setInterval(() => {
      const hour = new Date().getHours();
      if (hour !== this.currentHour) {
        this.flushMetrics();
        this.resetHourlyMetrics();
        this.currentHour = hour;
      }
    }, 60000); // Check every minute
  }

  private resetHourlyMetrics() {
    this.metrics.set('current', {
      requests: 0,
      errors: 0,
      rateLimitHits: 0,
      avgResponseTime: 0,
      activeUsers: new Set(),
      securityEvents: [],
    });
  }

  async logSecurityEvent(event: SecurityEvent): Promise<void> {
    const current = this.metrics.get('current');
    if (current) {
      current.securityEvents.push(event);
    }

    if (LOGGING_CONFIG.LOG_AUTH_ATTEMPTS && event.type === 'auth_failure') {
      console.warn('Authentication failure:', {
        ip: event.ip,
        endpoint: event.endpoint,
        timestamp: event.timestamp,
      });
    }

    if (LOGGING_CONFIG.LOG_RATE_LIMITS && event.type === 'rate_limit') {
      console.warn('Rate limit exceeded:', {
        ip: event.ip,
        userId: event.userId,
        endpoint: event.endpoint,
        timestamp: event.timestamp,
      });
    }

    if (redis) {
      const key = `security:events:${event.type}:${new Date().toISOString().split('T')[0]}`;
      try {
        await redis.zadd(key, Date.now(), JSON.stringify(event));
        await redis.expire(key, 7 * 24 * 3600); // Keep for 7 days
      } catch (error) {
        console.error('Failed to log security event to Redis:', error);
      }
    }

    if (IP_BLOCKING.AUTO_BLOCK.ENABLED) {
      await this.checkAutoBlock(event.ip);
    }
  }

  private async checkAutoBlock(ip: string): Promise<void> {
    if (!redis || IP_BLOCKING.ALLOWLIST.includes(ip)) return;

    const key = `violations:${ip}`;
    try {
      const violations = await redis.incr(key);
      await redis.expire(key, 3600); // Reset counter after 1 hour

      if (violations >= IP_BLOCKING.AUTO_BLOCK.THRESHOLD) {
        await this.blockIp(ip, IP_BLOCKING.AUTO_BLOCK.DURATION, 'Auto-blocked due to excessive violations');
      }
    } catch (error) {
      console.error('Failed to check auto-block:', error);
    }
  }

  async blockIp(ip: string, duration: number, reason: string): Promise<void> {
    if (!redis) return;

    try {
      const key = `blocked:${ip}`;
      await redis.setex(key, Math.ceil(duration / 1000), JSON.stringify({
        reason,
        blockedAt: new Date().toISOString(),
        duration,
      }));

      console.warn(`IP blocked: ${ip} for ${duration}ms - ${reason}`);
    } catch (error) {
      console.error('Failed to block IP:', error);
    }
  }

  async isIpBlocked(ip: string): Promise<boolean> {
    if (IP_BLOCKING.BLOCKLIST.includes(ip)) return true;

    if (IP_BLOCKING.ALLOWLIST.includes(ip)) return false;

    if (!redis) return false;

    try {
      const blocked = await redis.get(`blocked:${ip}`);
      return blocked !== null;
    } catch (error) {
      console.error('Failed to check IP block:', error);
      return false;
    }
  }

  trackRequest(_endpoint: string, userId?: string): void {
    const current = this.metrics.get('current');
    if (current) {
      current.requests++;
      if (userId) {
        current.activeUsers.add(userId);
      }
    }
  }

  trackError(endpoint: string, error: any): void {
    const current = this.metrics.get('current');
    if (current) {
      current.errors++;
    }

    if (LOGGING_CONFIG.LOG_ERRORS) {
      console.error('API Error:', {
        endpoint,
        error: error.message || error,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
    }
  }

  trackRateLimit(_ip: string, _userId?: string, _endpoint?: string): void {
    const current = this.metrics.get('current');
    if (current) {
      current.rateLimitHits++;
    }
  }

  trackResponseTime(duration: number): void {
    const current = this.metrics.get('current');
    if (current) {
      const totalTime = current.avgResponseTime * (current.requests - 1);
      current.avgResponseTime = (totalTime + duration) / current.requests;
    }
  }

  getMetrics(): MetricsData | undefined {
    return this.metrics.get('current');
  }

  private async flushMetrics(): Promise<void> {
    const current = this.metrics.get('current');
    if (!current || !redis) return;

    const hourKey = `metrics:${new Date().toISOString().split('T')[0]}:${this.currentHour}`;

    try {
      await redis.hset(hourKey, 'requests', current.requests.toString());
      await redis.hset(hourKey, 'errors', current.errors.toString());
      await redis.hset(hourKey, 'rateLimitHits', current.rateLimitHits.toString());
      await redis.hset(hourKey, 'avgResponseTime', current.avgResponseTime.toString());
      await redis.hset(hourKey, 'activeUsers', current.activeUsers.size.toString());
      await redis.hset(hourKey, 'timestamp', new Date().toISOString());

      await redis.expire(hourKey, 30 * 24 * 3600); // Keep for 30 days

      this.checkAlerts(current);
    } catch (error) {
      console.error('Failed to flush metrics:', error);
    }
  }

  private checkAlerts(metrics: MetricsData): void {
    const { ALERTS } = MONITORING_CONFIG;

    if (metrics.rateLimitHits > ALERTS.RATE_LIMIT_THRESHOLD) {
      console.error(`ALERT: High rate limit hits: ${metrics.rateLimitHits} in the last hour`);
    }

    const errorRate = metrics.requests > 0 ? metrics.errors / metrics.requests : 0;
    if (errorRate > ALERTS.ERROR_RATE_THRESHOLD) {
      console.error(`ALERT: High error rate: ${(errorRate * 100).toFixed(2)}%`);
    }

    if (metrics.avgResponseTime > ALERTS.RESPONSE_TIME_THRESHOLD) {
      console.error(`ALERT: High average response time: ${metrics.avgResponseTime}ms`);
    }
  }

  async getSecurityEvents(date: string, type?: string): Promise<SecurityEvent[]> {
    if (!redis) return [];

    const pattern = type ? `security:events:${type}:${date}` : `security:events:*:${date}`;

    try {
      const keys = await redis.keys(pattern);
      const events: SecurityEvent[] = [];

      for (const key of keys) {
        const rawEvents = await redis.zrange(key, 0, -1);
        for (const raw of rawEvents) {
          try {
            events.push(JSON.parse(raw));
          } catch (e) {
            console.error('Failed to parse security event:', e);
          }
        }
      }

      return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      console.error('Failed to get security events:', error);
      return [];
    }
  }

  async getHistoricalMetrics(date: string, hour?: number): Promise<any> {
    if (!redis) return null;

    const pattern = hour !== undefined
      ? `metrics:${date}:${hour}`
      : `metrics:${date}:*`;

    try {
      if (hour !== undefined) {
        return await redis.hgetall(pattern);
      } else {
        const keys = await redis.keys(pattern);
        const metrics = [];
        for (const key of keys) {
          const data = await redis.hgetall(key);
          metrics.push(data);
        }
        return metrics;
      }
    } catch (error) {
      console.error('Failed to get historical metrics:', error);
      return null;
    }
  }

  async cleanup(daysToKeep = 30): Promise<void> {
    if (!redis) return;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    try {
      // Clean up old security events
      const eventKeys = await redis.keys('security:events:*');
      for (const key of eventKeys) {
        const date = key.split(':')[3];
        if (date < cutoffStr) {
          await redis.del(key);
        }
      }

      // Clean up old metrics
      const metricKeys = await redis.keys('metrics:*');
      for (const key of metricKeys) {
        const date = key.split(':')[1];
        if (date < cutoffStr) {
          await redis.del(key);
        }
      }

      console.log(`Cleaned up data older than ${cutoffStr}`);
    } catch (error) {
      console.error('Failed to cleanup old data:', error);
    }
  }
}

// Export singleton instance
export const monitor = new SecurityMonitor();

export function trackingMiddleware(req: any, res: any, next: any) {
  const start = Date.now();

  // Track request
  monitor.trackRequest(req.url, req.session?.userId);

  // Override res.end to track response
  const originalEnd = res.end;
  res.end = function(...args: any[]) {
    // Track response time
    monitor.trackResponseTime(Date.now() - start);

    // Track errors
    if (res.statusCode >= 400) {
      if (res.statusCode === 429) {
        monitor.trackRateLimit(
          req.ip || req.connection.remoteAddress,
          req.session?.userId,
          req.url
        );
      } else if (res.statusCode >= 500) {
        monitor.trackError(req.url, new Error(`Server error: ${res.statusCode}`));
      }
    }

    return originalEnd.apply(res, args);
  };

  next();
}

export function sanitizeLog(data: any): any {
  if (typeof data !== 'object' || data === null) return data;

  const sanitized = Array.isArray(data) ? [...data] : { ...data };

  // Remove sensitive patterns
  for (const pattern of LOGGING_CONFIG.FILTER_PATTERNS) {
    const str = JSON.stringify(sanitized);
    const cleaned = str.replace(pattern, '[REDACTED]');
    return JSON.parse(cleaned);
  }

  return sanitized;
}