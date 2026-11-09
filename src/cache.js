function createCoursCache({
  db,
  scraper,
  logger,
  ttlMs,
  maxStaleMs,
  failureCooldownMs = 60 * 1000,
  now = () => Date.now()
}) {
  let inflight = null;
  let lastFailure = null;

  // Un seul scraping à la fois : les appels concurrents partagent la même promesse.
  function refresh() {
    if (!inflight) {
      inflight = (async () => {
        try {
          const data = await scraper();
          const updatedAt = now();
          db.setCache('cours', data, updatedAt);
          lastFailure = null;
          return { data, updatedAt };
        } catch (error) {
          lastFailure = { at: now(), error };
          throw error;
        }
      })().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  // Après un échec, on attend failureCooldownMs avant de solliciter à nouveau brvm.org.
  function inCooldown() {
    return Boolean(lastFailure) && now() - lastFailure.at < failureCooldownMs;
  }

  function readRow() {
    const row = db.getCache('cours');
    const age = row ? now() - row.updatedAt : Number.POSITIVE_INFINITY;
    return { row, age };
  }

  function staleResult(row, age, error) {
    return {
      data: row.value,
      updatedAt: row.updatedAt,
      ageMs: age,
      stale: true,
      source: 'stale',
      error
    };
  }

  async function get({ force = false } = {}) {
    const { row, age } = readRow();

    if (!force && row && age < ttlMs) {
      return {
        data: row.value,
        updatedAt: row.updatedAt,
        ageMs: age,
        stale: false,
        source: 'cache'
      };
    }

    if (!force && inCooldown()) {
      if (row && age < maxStaleMs) return staleResult(row, age, lastFailure.error);
      throw lastFailure.error;
    }

    try {
      const { data, updatedAt } = await refresh();
      return {
        data,
        updatedAt,
        ageMs: Math.max(0, now() - updatedAt),
        stale: false,
        source: 'fresh'
      };
    } catch (error) {
      if (row && age < maxStaleMs) {
        logger?.warn('Scraping échoué : utilisation de la dernière donnée connue', {
          ageMs: age,
          error: error.message
        });
        return staleResult(row, age, error);
      }
      throw error;
    }
  }

  // Rafraîchit en arrière-plan si la donnée expirera avant le prochain passage.
  async function refreshIfDue({ thresholdMs = ttlMs } = {}) {
    const { age } = readRow();
    if (age < thresholdMs || inCooldown() || inflight) return false;

    try {
      const { data } = await refresh();
      logger?.info('Cache rafraîchi en arrière-plan', { actions: data.actions?.length ?? 0 });
      return true;
    } catch (error) {
      logger?.warn('Rafraîchissement en arrière-plan échoué', { error: error.message });
      return false;
    }
  }

  function startAutoRefresh({ intervalMs } = {}) {
    if (!ttlMs) return () => {};
    const every = intervalMs ?? Math.max(30 * 1000, Math.floor(ttlMs / 3));
    const thresholdMs = Math.max(0, ttlMs - every);
    const timer = setInterval(() => {
      refreshIfDue({ thresholdMs });
    }, every);
    timer.unref();
    return () => clearInterval(timer);
  }

  // Lecture immédiate du cache, sans jamais déclencher de scraping (rendu des pages HTML).
  function peek() {
    const { row, age } = readRow();
    if (!row) return null;
    return {
      data: row.value,
      updatedAt: row.updatedAt,
      ageMs: age,
      stale: age >= ttlMs
    };
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

  return { get, peek, refreshIfDue, startAutoRefresh, status };
}

module.exports = { createCoursCache };
