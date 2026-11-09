const { hashVisitor } = require('../security');
const { countryOf, sourceOf, deviceOf } = require('../analytics');

const BOT_PATTERN =
  /bot|crawl|spider|slurp|headless|preview|monitor|curl|wget|python-requests|postman|uptime|lighthouse|facebookexternalhit|whatsapp|telegram/i;

// Cookie posé quand le visiteur refuse la mesure d'audience (page /confidentialite).
const OPT_OUT_COOKIE = 'brvm_no_stats';

// Pages publiques mesurées (les pages de compte et d'administration ne le sont pas).
const TRACKED_PATHS = [/^\/$/, /^\/api\.html$/, /^\/action\/[A-Z0-9.-]{1,20}$/, /^\/confidentialite$/];

function todayUtc(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function isTrackedPath(path) {
  return TRACKED_PATHS.some((pattern) => pattern.test(path));
}

function createVisitTracker({ db, config, logger }) {
  const ownHosts = [config.publicUrl ? new URL(config.publicUrl).hostname : null];

  return function trackVisits(req, res, next) {
    const userAgent = req.get('user-agent') || '';
    const isPageView =
      req.method === 'GET' &&
      isTrackedPath(req.path) &&
      req.accepts('html') &&
      !BOT_PATTERN.test(userAgent) &&
      req.get('sec-gpc') !== '1' &&
      req.get('dnt') !== '1' &&
      req.cookies?.[OPT_OUT_COOKIE] !== '1';

    if (!isPageView) return next();

    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;

      try {
        const now = Date.now();
        const day = todayUtc(now);
        const ip = req.ip || '';
        const visitorHash = hashVisitor(config.sessionSecret, day, ip, userAgent);
        const origin = sourceOf({
          referer: req.get('referer'),
          query: req.query,
          ownHosts: [...ownHosts, req.hostname]
        });

        db.recordVisit({
          day,
          path: req.path,
          visitorHash,
          createdAt: now,
          ...origin,
          country: countryOf(ip, logger),
          ...deviceOf(userAgent)
        });
      } catch (error) {
        logger?.warn('Impossible d’enregistrer la visite', { error: error.message });
      }
    });

    return next();
  };
}

module.exports = { createVisitTracker, todayUtc, isTrackedPath, OPT_OUT_COOKIE };
