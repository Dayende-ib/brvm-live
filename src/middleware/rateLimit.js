const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function limitHandler(message) {
  return (req, res, _next, options) => {
    res.status(options.statusCode).json({
      erreur: message,
      reessayez_dans_secondes: Math.ceil(options.windowMs / 1000)
    });
  };
}

function createRateLimiters(config) {
  const { windowMs, api, apiKey, visits, login, admin } = config.rateLimits;

  const apiLimiter = rateLimit({
    windowMs,
    limit: (req) => (req.apiKey ? apiKey : api),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (req.apiKey ? `key:${req.apiKeyId}` : ipKeyGenerator(req.ip)),
    handler: limitHandler('Trop de requêtes vers l’API, réessayez plus tard.')
  });

  const visitsLimiter = rateLimit({
    windowMs,
    limit: visits,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: limitHandler('Trop de requêtes, réessayez plus tard.')
  });

  const loginLimiter = rateLimit({
    windowMs,
    limit: login,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: limitHandler('Trop de tentatives de connexion, réessayez plus tard.')
  });

  const adminLimiter = rateLimit({
    windowMs,
    limit: admin,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: limitHandler('Trop de requêtes vers l’administration, réessayez plus tard.')
  });

  return { apiLimiter, visitsLimiter, loginLimiter, adminLimiter };
}

module.exports = { createRateLimiters };
