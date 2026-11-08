const {
  createSessionToken,
  verifySessionToken,
  hashApiKey,
  timingSafeEqualString
} = require('../security');

function extractApiKey(req) {
  const header = req.get('x-api-key');
  if (header) return header.trim();

  const authorization = req.get('authorization');
  if (authorization && /^Bearer\s+/i.test(authorization)) {
    return authorization.replace(/^Bearer\s+/i, '').trim();
  }
  return null;
}

function createApiKeyAuth(config) {
  const knownKeys = config.apiKeys.map((key) => {
    const hash = hashApiKey(key);
    return { hash, id: hash.slice(0, 12) };
  });

  return function apiKeyAuth(req, res, next) {
    const provided = extractApiKey(req);

    if (provided) {
      const hash = hashApiKey(provided);
      const match = knownKeys.find((entry) => timingSafeEqualString(entry.hash, hash));
      if (match) {
        req.apiKey = true;
        req.apiKeyId = match.id;
      }
    }

    if (config.apiKeysRequired && !req.apiKey) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="brvm-live"');
      return res.status(401).json({
        erreur:
          'Clé API requise. Fournissez-la via l’en-tête X-API-Key ou Authorization: Bearer <clé>.'
      });
    }

    return next();
  };
}

function createSessionManager(config) {
  const cookieName = 'brvm_admin';
  const baseOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProduction,
    path: '/admin'
  };

  return {
    cookieName,
    create(res) {
      const token = createSessionToken({
        username: config.admin.username,
        ttlMs: config.sessionTtlMs,
        secret: config.sessionSecret
      });
      res.cookie(cookieName, token, { ...baseOptions, maxAge: config.sessionTtlMs });
      return token;
    },
    read(req) {
      return verifySessionToken(req.cookies?.[cookieName], config.sessionSecret);
    },
    clear(res) {
      res.clearCookie(cookieName, baseOptions);
    }
  };
}

function requireAdmin(session) {
  return function adminGuard(req, res, next) {
    const data = session.read(req);
    if (!data) {
      if (req.accepts('html')) return res.redirect(303, '/admin/login');
      return res.status(401).json({ erreur: 'Authentification requise.' });
    }
    req.admin = data;
    req.sessionToken = req.cookies[session.cookieName];
    return next();
  };
}

function verifySameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();

  try {
    const host = new URL(origin).host;
    if (host !== req.get('host')) {
      return res.status(403).json({ erreur: 'Origine de la requête non autorisée.' });
    }
  } catch {
    return res.status(403).json({ erreur: 'Origine de la requête invalide.' });
  }

  return next();
}

function verifyCsrf(req, res, next) {
  const token = req.body?._csrf;
  if (!token || !req.sessionToken || !timingSafeEqualString(token, req.sessionToken)) {
    return res.status(403).json({ erreur: 'Jeton CSRF invalide. Rechargez la page.' });
  }
  return next();
}

module.exports = {
  createApiKeyAuth,
  createSessionManager,
  requireAdmin,
  verifySameOrigin,
  verifyCsrf
};
