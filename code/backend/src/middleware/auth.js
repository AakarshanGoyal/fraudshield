const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { unauthorized, forbidden } = require('../errors');

const JWT_SECRET = () => process.env.JWT_SECRET || 'jwt-secret-123';

// Gateway only: x-api-key must equal GATEWAY_API_KEY (constant-time compare)
function requireApiKey(req, res, next) {
  const expected = Buffer.from(process.env.GATEWAY_API_KEY || '');
  const given = Buffer.from(String(req.headers['x-api-key'] || ''));
  if (!expected.length || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return next(unauthorized('Missing or invalid API key'));
  }
  req.user = { username: 'gateway', role: 'GATEWAY' };
  return next();
}

// Users: Authorization: Bearer <jwt>
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized());
  try {
    req.user = jwt.verify(token, JWT_SECRET());
    return next();
  } catch {
    return next(unauthorized('Invalid or expired token'));
  }
}

const requireRole = (...roles) => (req, res, next) =>
  (req.user && roles.includes(req.user.role) ? next() : next(forbidden('Your role cannot use this API')));

const signToken = (user) => jwt.sign(
  { sub: user.user_id, username: user.username, role: user.role, customer_id: user.customer_id },
  JWT_SECRET(),
  { expiresIn: '12h' },
);

module.exports = { requireApiKey, requireAuth, requireRole, signToken };
