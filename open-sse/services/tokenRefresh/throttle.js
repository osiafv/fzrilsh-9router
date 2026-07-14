// Per-provider concurrency + rate limiter for token refresh
// Prevents rate-limit storms when many tokens expire simultaneously

const providerLimits = new Map();

class Throttle {
  constructor(maxConcurrent, minDelayMs = 0) {
    this.max = maxConcurrent;
    this.minDelayMs = minDelayMs;
    this.running = 0;
    this.queue = [];
    this.lastRequestTime = 0;
  }

  async run(fn, log) {
    // Wait for concurrency slot
    if (this.running >= this.max) {
      log?.info?.("TOKEN_REFRESH", `Throttle queue: ${this.queue.length + 1} waiting (${this.running}/${this.max} running)`);
      await new Promise(resolve => this.queue.push(resolve));
    }

    // Wait for rate limit spacing (time since last request started)
    if (this.minDelayMs > 0 && this.lastRequestTime > 0) {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      if (elapsed < this.minDelayMs) {
        const waitMs = this.minDelayMs - elapsed;
        log?.info?.("TOKEN_REFRESH", `Rate limit spacing: waiting ${waitMs}ms`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }

    this.lastRequestTime = Date.now();
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        this.queue.shift()();
      }
    }
  }
}

// Provider-specific limits: { maxConcurrent, minDelayMs }
// minDelayMs = minimum time between successive requests (rate limiting)
// ponytail: add exponential backoff on 403/429 when needed
const LIMITS = {
  kiro: { maxConcurrent: 1, minDelayMs: 3000 },    // Kiro CloudFront very aggressive: 1 at a time, 3s spacing
  xai: { maxConcurrent: 10, minDelayMs: 500 },     // xAI more permissive
  default: { maxConcurrent: 20, minDelayMs: 0 },   // Other providers: no spacing
};

export async function throttleRefresh(provider, fn, log) {
  const config = LIMITS[provider] || LIMITS.default;
  const maxConcurrent = typeof config === 'number' ? config : config.maxConcurrent;
  const minDelayMs = typeof config === 'number' ? 0 : (config.minDelayMs || 0);

  if (!providerLimits.has(provider)) {
    providerLimits.set(provider, new Throttle(maxConcurrent, minDelayMs));
  }

  const throttle = providerLimits.get(provider);
  return throttle.run(fn, log);
}
