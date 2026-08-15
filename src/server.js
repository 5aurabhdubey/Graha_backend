require('dotenv').config();
const { loadEnv } = require('./config/env');
const env = loadEnv(); // validates config and exits immediately if misconfigured — fail fast at boot

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');

const logger = require('./utils/logger');
const cache = require('./utils/cache');
const { requestId } = require('./middleware/requestId');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const kundaliRoute = require('./routes/kundali');
const chatRoute = require('./routes/chat');
const panchangRoute = require('./routes/panchang');
const matchRoute = require('./routes/match');

const app = express();

app.use(helmet()); // sets standard security headers (HSTS, no-sniff, frame options, etc.)
app.use(compression()); // gzip responses
app.use(cors({ origin: env.ALLOWED_ORIGIN }));
app.use(express.json({ limit: '256kb' }));
app.use(requestId);
app.use(pinoHttp({ logger, customProps: (req) => ({ requestId: req.id }) }));

// Chat is rate-limited more tightly than the rest of the API since it's the
// OpenAI-billed route — separate from the concurrency queue (this limits
// per-client request *rate*, the queue limits server-wide *concurrency*).
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.CHAT_RATE_LIMIT_PER_15MIN,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many questions in a short time — please wait a few minutes.' },
});

/**
 * Two separate health endpoints, because they answer two different
 * questions that your load balancer / orchestrator (e.g. Kubernetes, or a
 * simple nginx upstream check) needs answered differently:
 *
 * - /health/live  — "is the process alive?" Used to decide whether to
 *   restart this instance. Should almost never fail.
 * - /health/ready — "can this instance actually serve traffic right now?"
 *   Checks the cache/Redis connection. If it fails, the load balancer
 *   should stop sending new traffic here until it passes again.
 */
app.get('/health/live', (req, res) => res.json({ status: 'ok', pid: process.pid }));

app.get('/health/ready', async (req, res) => {
  try {
    await cache.set('__health_check__', '1', 5);
    const val = await cache.get('__health_check__');
    if (val !== '1') throw new Error('cache read-after-write mismatch');
    res.json({ status: 'ready', pid: process.pid });
  } catch (err) {
    logger.error({ err: err.message }, 'Readiness check failed');
    res.status(503).json({ status: 'not ready' });
  }
});

app.use('/api/kundali', kundaliRoute);
app.use('/api/chat', chatLimiter, chatRoute);
app.use('/api/panchang', panchangRoute);
app.use('/api/match', matchRoute);

app.use(notFoundHandler);
app.use(errorHandler); // must be last

const server = app.listen(env.PORT, () => {
  logger.info(`Graha backend (pid ${process.pid}) listening on port ${env.PORT}`);
});

/**
 * Graceful shutdown — when PM2/Docker/Kubernetes sends SIGTERM (e.g. during
 * a deploy or scale-down), stop accepting new connections but let in-flight
 * requests finish first, instead of dropping them mid-response.
 */
function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(async () => {
    await cache.close();
    logger.info('Shutdown complete');
    process.exit(0);
  });

  // Safety net: if something hangs, don't let the process linger forever.
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A crashed instance behind a load balancer is fine — the LB routes around
// it and your orchestrator restarts it. An instance that stays up in a
// broken state silently serving errors is worse. So: log loudly, then exit.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection — exiting');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});

module.exports = app;
