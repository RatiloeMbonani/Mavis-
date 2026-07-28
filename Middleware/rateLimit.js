const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const interviewLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 3,
  message: { error: 'Daily interview limit reached. Try again tomorrow.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.user_id || ipKeyGenerator(req),
});

module.exports = { authLimiter, interviewLimiter };