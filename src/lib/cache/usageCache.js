/**
 * In-memory cache for provider usage/quota data
 * Reduces external API calls by caching responses with TTL
 */

const DEFAULT_TTL = 60000; // 60 seconds
const CLEANUP_INTERVAL = 300000; // Cleanup every 5 minutes

class UsageCache {
  constructor() {
    this.cache = new Map();
    this.pendingFetches = new Map(); // Prevent duplicate concurrent fetches
    this.startCleanup();
  }

  /**
   * Get cached data if fresh
   * @param {string} key - Connection ID
   * @param {number} ttl - TTL in milliseconds
   * @returns {object|null} Cached data or null if stale/missing
   */
  get(key, ttl = DEFAULT_TTL) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set cached data
   * @param {string} key - Connection ID
   * @param {object} data - Usage data
   */
  set(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Delete cached entry
   * @param {string} key - Connection ID
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clear() {
    this.cache.clear();
    this.pendingFetches.clear();
  }

  /**
   * Get or fetch with deduplication
   * Prevents multiple concurrent fetches for same key
   * @param {string} key - Connection ID
   * @param {Function} fetchFn - Async function to fetch data
   * @param {number} ttl - TTL in milliseconds
   * @returns {Promise<object>} Cached or fresh data
   */
  async getOrFetch(key, fetchFn, ttl = DEFAULT_TTL) {
    // Check cache first
    const cached = this.get(key, ttl);
    if (cached) return cached;

    // Check if already fetching (dedup concurrent requests)
    const pending = this.pendingFetches.get(key);
    if (pending) return pending;

    // Fetch and cache
    const fetchPromise = fetchFn()
      .then(data => {
        this.set(key, data);
        this.pendingFetches.delete(key);
        return data;
      })
      .catch(error => {
        this.pendingFetches.delete(key);
        throw error;
      });

    this.pendingFetches.set(key, fetchPromise);
    return fetchPromise;
  }

  /**
   * Cleanup expired entries periodically
   */
  startCleanup() {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache.entries()) {
        const age = now - entry.timestamp;
        if (age > DEFAULT_TTL * 2) { // Remove entries older than 2x TTL
          this.cache.delete(key);
        }
      }
    }, CLEANUP_INTERVAL);

    // Don't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Get cache stats
   */
  getStats() {
    return {
      size: this.cache.size,
      pending: this.pendingFetches.size,
    };
  }
}

// Singleton instance
const usageCache = new UsageCache();

export default usageCache;
export { DEFAULT_TTL };
