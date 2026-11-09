const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function limitPage(message, retrySeconds) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Trop de requêtes - BRVM Live</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="error-page">
    <div>
      <p class="error-code">429</p>
      <h1>Trop de requêtes</h1>
      <p>${message} Réessayez dans ${retrySeconds} seconde(s).</p>
      <a class="btn" href="/">Retour aux cours</a>
    </div>
  </main>
</body>
</html>`;
}

function limitHandler(message, { html = false } = {}) {
  return (req, res, _next, options) => {
    const retrySeconds = Math.ceil(options.windowMs / 1000);
    if (html && req.accepts('html')) {
      return res.status(options.statusCode).type('html').send(limitPage(message, retrySeconds));
    }
    res.status(options.statusCode).json({
      erreur: message,
      reessayez_dans_secondes: retrySeconds
    });
  };
}

function createRateLimiters(config) {
  const { windowMs, api, apiKey, visits, login, admin, signup, userLogin, account } =
    config.rateLimits;

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

  const signupLimiter = rateLimit({
    windowMs,
    limit: signup,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Seules les inscriptions réussies comptent : une faute de saisie ne bloque pas l'utilisateur.
    skipFailedRequests: true,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: limitHandler('Trop de comptes créés depuis cette adresse, réessayez plus tard.', {
      html: true
    })
  });

  const userLoginLimiter = rateLimit({
    windowMs,
    limit: userLogin,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: limitHandler('Trop de tentatives de connexion, réessayez plus tard.', {
      html: true
    })
  });

  const accountLimiter = rateLimit({
    windowMs,
    limit: account,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: limitHandler('Trop de requêtes sur votre compte, réessayez plus tard.', {
      html: true
    })
  });

  return {
    apiLimiter,
    visitsLimiter,
    loginLimiter,
    adminLimiter,
    signupLimiter,
    userLoginLimiter,
    accountLimiter
  };
}

module.exports = { createRateLimiters };
