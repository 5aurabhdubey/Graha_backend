const PQueue = require('p-queue').default;
const logger = require('../utils/logger');

/**
 * Without this: 50 users ask a question at the same second → 50 simultaneous
 * OpenAI calls fire from one instance → you blow through your requests-per-
 * minute limit, OpenAI starts returning 429s, and users start seeing errors
 * even though your server itself is fine.
 *
 * With this: calls queue up and are released at a controlled concurrency —
 * users wait a little longer under heavy load instead of getting errors.
 * Combined with running multiple instances behind a load balancer, total
 * throughput scales with instance count while each instance protects its
 * own slice of your rate limit.
 */
const aiQueue = new PQueue({
  concurrency: Number(process.env.MAX_CONCURRENT_AI_CALLS || 10),
});

const prokeralaQueue = new PQueue({
  concurrency: Number(process.env.MAX_CONCURRENT_PROKERALA_CALLS || 15),
});

for (const [label, queue] of [['ai', aiQueue], ['prokerala', prokeralaQueue]]) {
  queue.on('active', () => {
    logger.debug({ queue: label, size: queue.size, pending: queue.pending }, 'queue active');
  });
}

module.exports = { aiQueue, prokeralaQueue };
