const {
  createSessionToken,
  verifySessionToken,
  createCsrfToken,
  verifyCsrfToken,
  hashApiKey,
  timingSafeEqualString
} = require('../security');

const CSRF_COOKIE = 'brvm_csrf';
const CSRF_TTL_MS = 2 * 60 * 60 * 1000;

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

function createCookieSession({ cookieName, path, sameSite, secret, ttlMs, secure, kind }) {
  const baseOptions = {
    httpOnly: true,
    sameSite,
    secure,
    path
  };

  return {
    cookieName,
    baseOptions,
    create(res, payload = {}) {
      const token = createSessionToken({
        subject: payload.sub,
        ttlMs,
        secret,
        extra: { ...payload, kind }
      });
      res.cookie(cookieName, token, { ...baseOptions, maxAge: ttlMs });
      return token;
    },
    read(req) {
      const data = verifySessionToken(req.cookies?.[cookieName], secret);
      if (!data || data.kind !== kind) return null;
      return data;
    },
    clear(res) {
      res.clearCookie(cookieName, baseOptions);
    }
  };
}

function createSessionManager(config) {
  const session = createCookieSession({
    cookieName: 'brvm_admin',
    path: '/admin',
    sameSite: 'strict',
    secure: config.isProduction,
    secret: config.sessionSecret,
    ttlMs: config.sessionTtlMs,
    kind: 'admin'
  });

  return {
    cookieName: session.cookieName,
    create(res, payload = {}) {
      return session.create(res, {
        ...payload,
        sub: payload.sub ?? config.admin.username
      });
    },
    read(req) {
      return session.read(req);
    },
    clear(res) {
      session.clear(res);
    }
  };
}

function createUserSessionManager(config) {
  const session = createCookieSession({
    cookieName: 'brvm_user',
    path: '/',
    sameSite: 'lax',
    secure: config.isProduction,
    secret: config.sessionSecret,
    ttlMs: config.userSessionTtlMs,
    kind: 'user'
  });

  return {
    cookieName: session.cookieName,
    create(res, user) {
      return session.create(res, {
        sub: String(user.id),
        username: user.username,
        // Version de session du compte : l'incrémenter en base invalide tous les cookies émis avant.
        ver: Number(user.sessionVersion ?? user.session_version ?? 0)
      });
    },
    read(req) {
      return session.read(req);
    },
    clear(res) {
      session.clear(res);
    }
  };
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    createdAt: Number(row.created_at),
    lastLoginAt: row.last_login_at == null ? null : Number(row.last_login_at),
    sessionVersion: Number(row.session_version ?? 0)
  };
}

function createUserLoader({ db, session }) {
  return function loadUser(req, res, next) {
    req.user = null;
    req.userSession = session.read(req);

    if (req.userSession) {
      const row = db.findUserById(Number(req.userSession.sub));
      const sameVersion = row && Number(row.session_version ?? 0) === Number(req.userSession.ver ?? 0);
      if (row && sameVersion) {
        req.user = publicUser(row);
      } else {
        session.clear(res);
        req.userSession = null;
      }
    }

    return next();
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
    return next();
  };
}

function requireUser(_session) {
  return function userGuard(req, res, next) {
    if (!req.user) {
      if (!req.path.startsWith('/api') && req.accepts('html')) {
        const next = encodeURIComponent(req.originalUrl || '/compte');
        return res.redirect(303, `/connexion?next=${next}`);
      }
      return res.status(401).json({ erreur: 'Connexion requise.' });
    }
    return next();
  };
}

function reject(req, res, status, message) {
  if (!req.path.startsWith('/api') && req.accepts('html')) {
    return res.status(status).type('html').send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Requête refusée - BRVM Live</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="error-page">
    <div>
      <p class="error-code">${status}</p>
      <h1>Requête refusée</h1>
      <p>${message}</p>
      <a class="btn" href="/">Retour aux cours</a>
    </div>
  </main>
</body>
</html>`);
  }
  return res.status(status).json({ erreur: message });
}

function verifySameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();

  try {
    const url = new URL(origin);
    const forwardedHost = req.get('x-forwarded-host');
    const allowedHosts = [req.get('host'), forwardedHost].filter(Boolean);
    if (!allowedHosts.includes(url.host)) {
      return reject(req, res, 403, 'Origine de la requête non autorisée.');
    }
  } catch {
    return reject(req, res, 403, 'Origine de la requête invalide.');
  }

  return next();
}

function createAuthCsrf(config) {
  const baseOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: CSRF_TTL_MS
  };

  function read(req) {
    const token = req.cookies?.[CSRF_COOKIE];
    if (!token || !verifyCsrfToken(token, config.sessionSecret)) return null;
    return token;
  }

  function check(req) {
    const bodyToken = req.body?._csrf;
    const cookieToken = read(req);
    if (!bodyToken || !cookieToken) return false;
    return timingSafeEqualString(bodyToken, cookieToken);
  }

  return {
    cookieName: CSRF_COOKIE,
    ensure(req, res) {
      const existing = read(req);
      if (existing) return existing;
      const token = createCsrfToken({ secret: config.sessionSecret, ttlMs: CSRF_TTL_MS });
      res.cookie(CSRF_COOKIE, token, baseOptions);
      return token;
    },
    check,
    verify(req, res, next) {
      if (!check(req)) {
        return reject(req, res, 403, 'Jeton CSRF invalide. Rechargez la page.');
      }
      return next();
    }
  };
}

function verifyApiCsrf(config) {
  return function apiCsrf(req, res, next) {
    const headerToken = req.get('x-csrf-token');
    const cookieToken = req.cookies?.[CSRF_COOKIE];
    if (!headerToken || !cookieToken) {
      return res.status(403).json({ erreur: 'Jeton CSRF manquant. Rechargez la page.' });
    }
    if (!timingSafeEqualString(headerToken, cookieToken)) {
      return res.status(403).json({ erreur: 'Jeton CSRF invalide. Rechargez la page.' });
    }
    if (!verifyCsrfToken(cookieToken, config.sessionSecret)) {
      return res.status(403).json({ erreur: 'Jeton CSRF expiré. Rechargez la page.' });
    }
    return next();
  };
}

module.exports = {
  createApiKeyAuth,
  createSessionManager,
  createUserSessionManager,
  createUserLoader,
  createAuthCsrf,
  requireAdmin,
  requireUser,
  verifySameOrigin,
  verifyApiCsrf,
  publicUser
};
