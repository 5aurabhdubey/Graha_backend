const NodeCache = require('node-cache');
const Redis = require('ioredis');
const logger = require('./logger');

/**
 * Why this matters once you're load-balanced: with plain in-memory caching,
 * each replica has its own cache. User hits replica A, gets cached; next
 * request gets routed to replica B, which has never seen it — cache miss,
 * repeat API call, and worse, inconsistent data across replicas. Redis gives
 * every replica the same shared cache, which is what "production grade"
 * actually requires once you're running more than one instance.
 *
 * If REDIS_URL isn't set, this transparently falls back to in-memory —
 * totally fine for local dev or a single-instance deployment.
 */
class CacheService {
  constructor(redisUrl) {
    this.useRedis = Boolean(redisUrl);

    if (this.useRedis) {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 2000),
      });
      this.redis.on('error', (err) => {
        logger.error({ err }, 'Redis connection error — cache calls will fail until it recovers');
      });
      this.redis.on('connect', () => logger.info('Connected to Redis cache'));
    } else {
      logger.warn('REDIS_URL not set — using in-memory cache (fine for single-instance dev, not for load-balanced production)');
      this.memory = new NodeCache();
    }
  }

  async get(key) {
    try {
      if (this.useRedis) {
        const val = await this.redis.get(key);
        return val ? JSON.parse(val) : null;
      }
      return this.memory.get(key) ?? null;
    } catch (err) {
      logger.error({ err, key }, 'Cache read failed — treating as a miss');
      return null; // a cache failure should degrade to "fetch fresh", never crash the request
    }
  }

  async set(key, value, ttlSeconds) {
    try {
      if (this.useRedis) {
        await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      } else {
        this.memory.set(key, value, ttlSeconds);
      }
    } catch (err) {
      logger.error({ err, key }, 'Cache write failed — continuing without caching this value');
      // Don't throw — a failed cache write shouldn't fail the user's request.
    }
  }

  async close() {
    if (this.useRedis) await this.redis.quit();
  }
}

module.exports = new CacheService(process.env.REDIS_URL);
