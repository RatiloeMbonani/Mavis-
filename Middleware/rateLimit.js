const rateLimit = require('express-rate-limit');

// General auth protection- limit the mumber of attemps to save our application from bruteforce 
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,                   // 10 attempts per IP per window
    message: { error: 'Too many attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Stricter limit for starting interviews - so that users do not burn our tokens
const interviewLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 1,  // one mock interview for one user to preserve our tokens                        
    message: { error: 'Daily interview limit reached. Try again tomorrow.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.user_id || req.ip, // limit per logged-in user, not just per IP
});

module.exports = { authLimiter, interviewLimiter };