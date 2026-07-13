// Per-provider concurrency limiter for token refresh
// Prevents rate-limit storms when many tokens expire simultaneously

const providerLimits = new Map();

class Throttle {
  constructor(maxConcurrent) {
    this.max = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  async run(fn, log) {
    if (this.running >= this.max) {
      log?.info?.("TOKEN_REFRESH", `Throttle queue: ${this.queue.length + 1} waiting (${this.running}/${this.max} running)`);
      await new Promise(resolve => this.queue.push(resolve));
    }
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

// Provider-specific concurrency limits
// ponytail: could add retry/backoff here when we need it
const LIMITS = {
  kiro: 5,        // Kiro OAuth has aggressive rate limiting
  xai: 10,        // xAI more permissive
  default: 20,    // Other providers
};

export async function throttleRefresh(provider, fn, log) {
  const limit = LIMITS[provider] || LIMITS.default;

  if (!providerLimits.has(provider)) {
    providerLimits.set(provider, new Throttle(limit));
  }

  const throttle = providerLimits.get(provider);
  return throttle.run(fn, log);
}
