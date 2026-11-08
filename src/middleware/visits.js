const { hashVisitor } = require('../security');

const BOT_PATTERN =
  /bot|crawl|spider|slurp|headless|preview|monitor|curl|wget|python-requests|postman|uptime/i;

function todayUtc(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function createVisitTracker({ db, config, logger }) {
  return function trackVisits(req, res, next) {
    const isPageView =
      req.method === 'GET' &&
      req.path === '/' &&
      req.accepts('html') &&
      !BOT_PATTERN.test(req.get('user-agent') || '') &&
      req.get('sec-gpc') !== '1' &&
      req.get('dnt') !== '1';

    if (!isPageView) return next();

    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 400) return;

      try {
        const now = Date.now();
        const day = todayUtc(now);
        const visitorHash = hashVisitor(
          config.sessionSecret,
          day,
          req.ip || '',
          req.get('user-agent') || ''
        );
        db.recordVisit({ day, path: '/', visitorHash, createdAt: now });
      } catch (error) {
        logger?.warn('Impossible d’enregistrer la visite', { error: error.message });
      }
    });

    return next();
  };
}

module.exports = { createVisitTracker, todayUtc };
