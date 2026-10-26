import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from './errors.js';

export interface RateRule {
  name: string;
  max: number;
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimitedError extends ApiError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(429, 'rate_limited', 'Hiciste demasiados intentos. Espera unos minutos y vuelve a intentarlo.');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(sweepEveryMs = 60_000) {
    this.sweeper = setInterval(() => this.sweep(), sweepEveryMs);
    this.sweeper.unref();
  }

  hit(rule: RateRule, key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const id = `${rule.name}:${key}`;
    let bucket = this.buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + rule.windowMs };
      this.buckets.set(id, bucket);
    }
    bucket.count += 1;
    return { allowed: bucket.count <= rule.max, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  enforce(rule: RateRule, key: string, reply?: FastifyReply): void {
    const result = this.hit(rule, key);
    if (result.allowed) return;
    reply?.header('Retry-After', String(result.retryAfterSeconds));
    throw new RateLimitedError(result.retryAfterSeconds);
  }

  hook(rule: RateRule, keyOf: (request: FastifyRequest) => string | null = (request) => request.ip) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const key = keyOf(request);
      if (key) this.enforce(rule, key, reply);
    };
  }

  sweep(now = Date.now()): void {
    for (const [id, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(id);
  }

  close(): void {
    clearInterval(this.sweeper);
    this.buckets.clear();
  }
}
