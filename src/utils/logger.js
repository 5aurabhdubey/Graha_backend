const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined, // production: plain JSON lines, ready for CloudWatch/Datadog/ELK etc.
  redact: {
    // Never let secrets or PII accidentally end up in logs.
    paths: ['req.headers.authorization', '*.client_secret', '*.OPENAI_API_KEY', '*.PROKERALA_CLIENT_SECRET'],
    censor: '[redacted]',
  },
});

module.exports = logger;
