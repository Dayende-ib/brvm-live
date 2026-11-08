const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const { createApiKeyAuth, createSessionManager } = require('./middleware/auth');
const { createRateLimiters } = require('./middleware/rateLimit');
const { createVisitTracker } = require('./middleware/visits');
const { createApiRouter } = require('./routes/api');
const { createAdminRouter } = require('./routes/admin');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = '2.0.0';

function createApp({ config, db, cache, logger }) {
  const app = express();
  const publicDir = PUBLIC_DIR;

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.isProduction ? [] : null
        }
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: config.isProduction
        ? { maxAge: 31536000, includeSubDomains: true, preload: false }
        : false
    })
  );

  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: false, limit: '10kb', parameterLimit: 20 }));

  const corsOrigin = config.allowedOrigins.includes('*')
    ? '*'
    : config.allowedOrigins.length
      ? config.allowedOrigins
      : '*';

  app.use(
    '/api',
    cors({
      origin: corsOrigin,
      methods: ['GET', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
      maxAge: 86400
    })
  );

  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const isApi = req.path.startsWith('/api');
      const isAdmin = req.path.startsWith('/admin');
      if (!isApi && !isAdmin) return;

      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger?.info('requête', {
        methode: req.method,
        chemin: req.path,
        statut: res.statusCode,
        duree_ms: Math.round(durationMs),
        ip: req.ip,
        cle_api: req.apiKeyId
      });
    });
    next();
  });

  app.use(createVisitTracker({ db, config, logger }));

  app.get('/health', (req, res) => {
    let databaseOk = false;
    try {
      databaseOk = db.ping();
    } catch (error) {
      logger?.error('Healthcheck : base de données inaccessible', { error: error.message });
    }

    const cacheStatus = cache.status();
    const cacheAge = cacheStatus.ageMs;
    const cacheState =
      cacheStatus.present && cacheAge != null && cacheAge <= config.cacheTtlMs
        ? 'frais'
        : cacheStatus.present
          ? 'perime'
          : 'vide';

    return res.status(databaseOk ? 200 : 503).json({
      statut: databaseOk ? 'ok' : 'erreur',
      version: VERSION,
      uptime_s: Math.round(process.uptime()),
      base_de_donnees: databaseOk ? 'ok' : 'erreur',
      cache: {
        etat: cacheState,
        age_s: cacheAge == null ? null : Math.round(cacheAge / 1000),
        actions: cacheStatus.actions ?? 0
      }
    });
  });

  const apiKeyAuth = createApiKeyAuth(config);
  const limiters = createRateLimiters(config);
  const session = createSessionManager(config);

  app.use('/api', apiKeyAuth);
  app.use('/api/cours', limiters.apiLimiter);
  app.use('/api/visites', limiters.visitsLimiter);
  app.use('/api', createApiRouter({ config, cache, db, logger }));

  app.use('/admin', createAdminRouter({ config, cache, db, session, logger, limiters }));

  app.use(
    express.static(publicDir, {
      index: 'index.html',
      etag: true,
      maxAge: config.isProduction ? '1h' : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      }
    })
  );

  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ erreur: 'Endpoint non trouvé' });
    }
    return res.status(404).sendFile(path.join(publicDir, '404.html'));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      return res.status(400).json({ erreur: 'Corps de requête invalide.' });
    }

    logger?.error('Erreur non gérée', {
      methode: req.method,
      chemin: req.path,
      error: error.message,
      stack: error.stack
    });

    if (req.path.startsWith('/api')) {
      return res.status(500).json({ erreur: 'Erreur serveur interne' });
    }
    return res.status(500).sendFile(path.join(publicDir, '500.html'));
  });

  return app;
}

module.exports = { createApp, VERSION };
