// One error format for every API: { error: { code, message, fields? } }
const { ZodError } = require('zod');

class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const invalid = (message, fields) => new HttpError(422, 'VALIDATION_ERROR', message, fields);
const unauthorized = (message = 'Missing or invalid credentials') => new HttpError(401, 'UNAUTHORIZED', message);
const forbidden = (message = 'You are not allowed to do this') => new HttpError(403, 'FORBIDDEN', message);
const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);
const conflict = (message) => new HttpError(409, 'CONFLICT', message);

// Wraps async route handlers so thrown errors reach the error handler
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function zodFields(err) {
  const fields = {};
  for (const issue of err.issues) fields[issue.path.join('.') || '_'] = issue.message;
  return fields;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', fields: zodFields(err) } });
  }
  if (err instanceof HttpError) {
    const body = { code: err.code, message: err.message };
    if (err.fields) body.fields = err.fields;
    return res.status(err.status).json({ error: body });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body is not valid JSON' } });
  }
  console.error(err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}

module.exports = { HttpError, invalid, unauthorized, forbidden, notFound, conflict, ah, errorHandler };
