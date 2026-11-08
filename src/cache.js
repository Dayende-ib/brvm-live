function createCoursCache({ db, scraper, logger, ttlMs, maxStaleMs, now = () => Date.now() }) {
  let inflight = null;

  async function refresh() {
    const data = await scraper();
    db.setCache('cours', data, now());
    return data;
  }

  async function get({ force = false } = {}) {
    const row = db.getCache('cours');
    const current = now();
    const age = row ? current - row.updatedAt : Number.POSITIVE_INFINITY;

    if (!force && row && age < ttlMs) {
      return {
        data: row.value,
        updatedAt: row.updatedAt,
        ageMs: age,
        stale: false,
        source: 'cache'
      };
    }

    if (!inflight) {
      inflight = refresh().finally(() => {
        inflight = null;
      });
    }

    try {
      const data = await inflight;
      return {
        data,
        updatedAt: now(),
        ageMs: 0,
        stale: false,
        source: 'fresh'
      };
    } catch (error) {
      if (row && age < maxStaleMs) {
        logger?.warn('Scraping échoué : utilisation de la dernière donnée connue', {
          ageMs: age,
          error: error.message
        });
        return {
          data: row.value,
          updatedAt: row.updatedAt,
          ageMs: age,
          stale: true,
          source: 'stale',
          error
        };
      }
      throw error;
    }
  }

  function status() {
    const row = db.getCache('cours');
    if (!row) return { present: false, updatedAt: null, ageMs: null };
    return {
      present: true,
      updatedAt: row.updatedAt,
      ageMs: now() - row.updatedAt,
      actions: Array.isArray(row.value?.actions) ? row.value.actions.length : 0,
      maj: row.value?.maj ?? null
    };
  }

  return { get, status };
}

module.exports = { createCoursCache };
