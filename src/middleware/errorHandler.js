const logger = require('../utils/logger');

/** Wraps an async route handler so thrown errors reach the error middleware instead of crashing the process. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Central error handler — must be registered last, after all routes. */
function errorHandler(err, req, res, next) {
  const status = err.status || 502;

  logger.error({ err: err.message, stack: err.stack, requestId: req.id, path: req.path }, 'Request failed');

  // Never leak stack traces or internal error details to the client.
  res.status(status).json({
    error: status === 502
      ? 'One of our services is temporarily unavailable. Please try again shortly.'
      : 'Something went wrong on our end.',
    requestId: req.id,
  });
}

/** Catches routes that don't exist, instead of Express's default HTML 404. */
function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route: ${req.method} ${req.path}`, requestId: req.id });
}

module.exports = { asyncHandler, errorHandler, notFoundHandler };
