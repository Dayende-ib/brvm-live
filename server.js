const { loadConfig } = require('./src/config');
const { createLogger } = require('./src/logger');
const { openDatabase } = require('./src/db');
const { createScraper } = require('./src/scraper');
const { createCoursCache } = require('./src/cache');
const { createApp } = require('./src/app');

const DAY_MS = 24 * 60 * 60 * 1000;

function start() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    console.error(`[configuration] ${error.message}`);
    process.exit(1);
  }

  const logger = createLogger({ env: config.nodeEnv });
  for (const warning of config.warnings) logger.warn(warning);

  const db = openDatabase(config.dataDir, logger);
  const scraper = createScraper({ config, logger });
  const cache = createCoursCache({
    db,
    scraper: scraper.scrape,
    logger,
    ttlMs: config.cacheTtlMs,
    maxStaleMs: config.cacheMaxStaleMs
  });
  const app = createApp({ config, db, cache, logger });

  const server = app.listen(config.port, config.host, () => {
    logger.info('BRVM Live démarré', {
      port: config.port,
      host: config.host,
      env: config.nodeEnv,
      base: db.file
    });
  });

  server.on('error', (error) => {
    logger.error('Impossible de démarrer le serveur HTTP', { error: error.message });
    db.close();
    process.exit(1);
  });

  function cleanupVisits() {
    try {
      const before = new Date(Date.now() - config.visitsRetentionDays * DAY_MS)
        .toISOString()
        .slice(0, 10);
      const deleted = db.deleteVisitsBefore(before);
      if (deleted > 0) logger.info('Anciennes visites purgées', { supprimees: deleted, avant: before });
    } catch (error) {
      logger.warn('Purge des visites impossible', { error: error.message });
    }
  }

  cleanupVisits();
  const cleanupTimer = setInterval(cleanupVisits, DAY_MS);
  cleanupTimer.unref();

  cache
    .get()
    .then((result) => {
      logger.info('Cache initialisé', {
        source: result.source,
        actions: result.data.actions.length,
        perime: result.stale
      });
    })
    .catch((error) => {
      logger.warn('Préchauffage du cache échoué (nouvelle tentative à la prochaine requête)', {
        error: error.message
      });
    });

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Arrêt en cours', { signal });

    const forceExit = setTimeout(() => {
      logger.error('Arrêt forcé après 10 s');
      process.exit(1);
    }, 10000);
    forceExit.unref();

    server.close((error) => {
      if (error) logger.error('Erreur lors de la fermeture du serveur', { error: error.message });
      clearInterval(cleanupTimer);
      try {
        db.close();
      } catch (dbError) {
        logger.error('Erreur lors de la fermeture de la base', { error: dbError.message });
      }
      clearTimeout(forceExit);
      logger.info('Arrêt terminé');
      process.exit(error ? 1 : 0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Promesse rejetée non gérée', {
      error: reason instanceof Error ? reason.message : String(reason)
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Exception non capturée', { error: error.message, stack: error.stack });
    shutdown('uncaughtException');
  });

  return { server, db, cache, config, logger };
}

if (require.main === module) start();

module.exports = { start };
