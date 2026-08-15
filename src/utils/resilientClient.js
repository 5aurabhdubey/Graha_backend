const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const CircuitBreaker = require('opossum');
const logger = require('./logger');

/**
 * Two layers of resilience, doing two different jobs:
 *
 * 1. RETRY (axios-retry) — handles transient blips: a dropped connection,
 *    a single slow response, a momentary 502. Retries a few times with
 *    exponential backoff before giving up on that one call.
 *
 * 2. CIRCUIT BREAKER (opossum) — handles sustained outages. If Prokerala or
 *    OpenAI is actually down/degraded, retrying every single request just
 *    piles up latency and hammers a struggling service. After enough
 *    failures, the breaker "opens" — it stops calling out entirely for a
 *    cooldown period and fails fast instead, so your app stays responsive
 *    (returning a graceful fallback) rather than every request hanging
 *    until timeout.
 */
function createResilientClient({ name, baseTimeoutMs = 8000 }) {
  const instance = axios.create({ timeout: baseTimeoutMs });

  axiosRetry(instance, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay, // 1s, 2s, 4s between attempts
    retryCondition: (error) => {
      // Retry network errors and 5xx/429 — never retry a 4xx we caused (bad request, auth, etc.)
      return (
        axiosRetry.isNetworkOrIdempotentRequestError(error) ||
        error.response?.status === 429 ||
        (error.response?.status >= 500 && error.response?.status < 600)
      );
    },
    onRetry: (retryCount, error, requestConfig) => {
      logger.warn({ name, retryCount, url: requestConfig.url, err: error.message }, 'Retrying upstream call');
    },
  });

  const breaker = new CircuitBreaker(
    async (config) => instance.request(config),
    {
      timeout: baseTimeoutMs + 2000, // slightly above axios's own timeout
      errorThresholdPercentage: 50, // opens after 50% of recent calls fail
      resetTimeout: 15000, // after opening, wait 15s before trying again (half-open probe)
      rollingCountTimeout: 10000,
      name,
    }
  );

  breaker.on('open', () => logger.error({ name }, `Circuit OPEN — ${name} is failing repeatedly, short-circuiting further calls for 15s`));
  breaker.on('halfOpen', () => logger.info({ name }, `Circuit half-open — probing ${name} again`));
  breaker.on('close', () => logger.info({ name }, `Circuit closed — ${name} has recovered`));

  return {
    /** Fires the request through retry + circuit breaker. Throws opossum's
     * own error when the circuit is open — callers should catch this and
     * return a graceful fallback rather than a raw 500. */
    request: (config) => breaker.fire(config),
    breaker,
  };
}

module.exports = { createResilientClient };
