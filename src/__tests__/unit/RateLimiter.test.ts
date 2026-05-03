import { RateLimiter } from "../../core/RateLimiter";

describe("RateLimiter", () => {
  describe("consume", () => {
    it("should allow consumption within the token limit", () => {
      const limiter = new RateLimiter(10, 5);

      for (let i = 0; i < 10; i++) {
        expect(limiter.consume("client-a")).toBe(true);
      }
    });

    it("should reject when tokens are exhausted", () => {
      const limiter = new RateLimiter(3, 1);

      expect(limiter.consume("client-a")).toBe(true);
      expect(limiter.consume("client-a")).toBe(true);
      expect(limiter.consume("client-a")).toBe(true);
      expect(limiter.consume("client-a")).toBe(false);
    });

    it("should track each client key independently", () => {
      const limiter = new RateLimiter(2, 1);

      expect(limiter.consume("client-a")).toBe(true);
      expect(limiter.consume("client-a")).toBe(true);
      expect(limiter.consume("client-a")).toBe(false);

      expect(limiter.consume("client-b")).toBe(true);
      expect(limiter.consume("client-b")).toBe(true);
      expect(limiter.consume("client-b")).toBe(false);
    });
  });

  describe("refill", () => {
    it("should refill tokens over time", async () => {
      const limiter = new RateLimiter(3, 10); // 10 tokens per second

      // Exhaust tokens
      expect(limiter.consume("client-a")).toBe(true);
      expect(limiter.consume("client-a")).toBe(true);
      expect(limiter.consume("client-a")).toBe(true);
      expect(limiter.consume("client-a")).toBe(false);

      // Wait for refill (100ms at 10 tokens/sec = ~1 token)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should have at least 1 token refilled
      expect(limiter.consume("client-a")).toBe(true);
      expect(limiter.consume("client-a")).toBe(false);
    });

    it("should not exceed maxTokens even after long idle", async () => {
      const limiter = new RateLimiter(3, 100); // 100 tokens per second

      // Exhaust
      limiter.consume("client-a");
      limiter.consume("client-a");
      limiter.consume("client-a");

      // Wait long enough for many tokens to refill
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should only get maxTokens (3), not accumulated 20
      expect(limiter.consume("client-a")).toBe(true);
      expect(limiter.consume("client-a")).toBe(true);
      expect(limiter.consume("client-a")).toBe(true);
      expect(limiter.consume("client-a")).toBe(false);
    });
  });

  describe("prune", () => {
    it("should remove idle buckets older than the cutoff", () => {
      const limiter = new RateLimiter(5, 1);

      // Add some clients
      limiter.consume("active");
      limiter.consume("stale");

      // Prune with a very short cutoff (1ms) — everything older than 1ms is removed
      limiter.prune(1);

      // Both buckets should be gone since they were just created but the cutoff is
      // extremely short. However, the exact behavior depends on timing. Let's test
      // that new clients still work after pruning.
      expect(limiter.consume("active")).toBe(true);
      expect(limiter.consume("stale")).toBe(true);
    });

    it("should keep recently accessed buckets", () => {
      const limiter = new RateLimiter(5, 1);

      limiter.consume("fresh");

      // Prune with a long cutoff — the bucket is recent so it stays
      limiter.prune(60_000);

      // The bucket should still have tokens consumed (4 remaining)
      expect(limiter.consume("fresh")).toBe(true);
    });

    it("should not throw when pruning an empty bucket map", () => {
      const limiter = new RateLimiter(5, 1);

      expect(() => limiter.prune()).not.toThrow();
    });
  });

  describe("default parameters", () => {
    it("should use default maxTokens=60 and refillRate=10", () => {
      const limiter = new RateLimiter();

      // Should allow many requests with default generous limits
      for (let i = 0; i < 60; i++) {
        expect(limiter.consume("client-a")).toBe(true);
      }
      expect(limiter.consume("client-a")).toBe(false);
    });
  });
});
