/**
 * Token-bucket rate limiter for WebSocket message handling.
 *
 * Each client is identified by a key (typically its IP address). The bucket
 * starts with `maxTokens` and refills at `refillRate` tokens per second.
 * When a client exceeds the limit, `consume` returns false and the message
 * should be rejected.
 *
 * Idle buckets are pruned periodically to avoid unbounded memory growth.
 */
export class RateLimiter {
  private buckets = new Map<
    string,
    { tokens: number; lastRefill: number }
  >();

  constructor(
    private maxTokens: number = 60,
    private refillRate: number = 10,
  ) {}

  /**
   * Attempt to consume a token for the given key.
   * Returns true if the request is allowed, false if rate-limited.
   */
  consume(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? {
      tokens: this.maxTokens,
      lastRefill: now,
    };

    // Refill tokens based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.maxTokens,
      bucket.tokens + elapsed * this.refillRate,
    );
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }

    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  /**
   * Remove buckets that haven't been accessed recently.
   * Call periodically (e.g. every 60 seconds) to prevent memory leaks.
   */
  prune(olderThanMs: number = 60_000): void {
    const cutoff = Date.now() - olderThanMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefill < cutoff) {
        this.buckets.delete(key);
      }
    }
  }
}
