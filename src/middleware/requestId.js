const { v4: uuidv4 } = require('uuid');

/**
 * Every request gets a unique ID, attached to the request and echoed back
 * in a response header. When a user reports "my chat failed at 3:42pm",
 * you can find the exact request in your logs instead of guessing.
 */
function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = { requestId };
