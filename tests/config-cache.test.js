const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../src/config');
const { createCoursCache } = require('../src/cache');

describe('Configuration', () => {
  it('refuse la production sans SESSION_SECRET', () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: 'production' }),
      /SESSION_SECRET est requis en production/
    );
  });

  it('génère un secret éphémère hors production avec un avertissement', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    assert.equal(config.sessionSecret.length, 64);
    assert.ok(config.warnings.some((warning) => /SESSION_SECRET absent/.test(warning)));
  });

  it('parse les clés API et les origines', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      SESSION_SECRET: 'x'.repeat(48),
      API_KEYS: 'cle-un-tres-longue-1234, cle-deux-tres-longue-5678',
      ALLOWED_ORIGINS: 'https://a.test, https://b.test',
      TRUST_PROXY: '2'
    });

    assert.deepEqual(config.apiKeys, ['cle-un-tres-longue-1234', 'cle-deux-tres-longue-5678']);
    assert.deepEqual(config.allowedOrigins, ['https://a.test', 'https://b.test']);
    assert.equal(config.trustProxy, 2);
    assert.equal(config.admin.enabled, false);
  });

  it('refuse un PORT invalide', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'test', PORT: 'abc' }), /Configuration invalide/);
  });
});

describe('Cache', () => {
  function memoryDb(initial = null) {
    let row = initial;
    return {
      getCache: () => row,
      setCache: (_key, value, updatedAt) => {
        row = { value, updatedAt };
      }
    };
  }

  const payload = { actions: [{ symbole: 'ABJC' }] };

  it('sert le cache frais sans appeler le scraper', async () => {
    let calls = 0;
    const now = 1_000_000;
    const db = memoryDb({ value: payload, updatedAt: now - 1000 });
    const cache = createCoursCache({
      db,
      scraper: async () => {
        calls += 1;
        return payload;
      },
      logger: null,
      ttlMs: 60_000,
      maxStaleMs: 3_600_000,
      now: () => now
    });

    const result = await cache.get();
    assert.equal(result.source, 'cache');
    assert.equal(calls, 0);
  });

  it('rafraîchit le cache expiré', async () => {
    let calls = 0;
    const now = 1_000_000;
    const db = memoryDb({ value: payload, updatedAt: now - 120_000 });
    const cache = createCoursCache({
      db,
      scraper: async () => {
        calls += 1;
        return { actions: [{ symbole: 'NEW' }] };
      },
      logger: null,
      ttlMs: 60_000,
      maxStaleMs: 3_600_000,
      now: () => now
    });

    const result = await cache.get();
    assert.equal(result.source, 'fresh');
    assert.equal(result.data.actions[0].symbole, 'NEW');
    assert.equal(calls, 1);
  });

  it('retombe sur le cache périmé quand le scraping échoue', async () => {
    const now = 1_000_000;
    const db = memoryDb({ value: payload, updatedAt: now - 120_000 });
    const cache = createCoursCache({
      db,
      scraper: async () => {
        throw new Error('réseau indisponible');
      },
      logger: null,
      ttlMs: 60_000,
      maxStaleMs: 3_600_000,
      now: () => now
    });

    const result = await cache.get();
    assert.equal(result.stale, true);
    assert.equal(result.source, 'stale');
    assert.equal(result.data.actions[0].symbole, 'ABJC');
  });

  it('propage l’erreur sans cache de secours', async () => {
    const db = memoryDb(null);
    const cache = createCoursCache({
      db,
      scraper: async () => {
        throw new Error('réseau indisponible');
      },
      logger: null,
      ttlMs: 60_000,
      maxStaleMs: 3_600_000,
      now: () => 1_000_000
    });

    await assert.rejects(() => cache.get(), /réseau indisponible/);
  });
});
