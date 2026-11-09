const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../src/config');
const { createCoursCache } = require('../src/cache');
const { hashPassword } = require('../src/security');

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

  it('signale un ADMIN_PASSWORD_HASH corrompu (ex. $ interprétés par Docker Compose)', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      ADMIN_PASSWORD_HASH: 'scrypt16384816'
    });
    assert.ok(config.warnings.some((warning) => /ADMIN_PASSWORD_HASH/.test(warning)));
  });

  it('accepte un ADMIN_PASSWORD_HASH valide sans avertissement', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      ADMIN_PASSWORD_HASH: hashPassword('mot-de-passe-de-test-123')
    });
    assert.ok(!config.warnings.some((warning) => /format attendu/.test(warning)));
  });

  it('traite les variables vides comme absentes', () => {
    const config = loadConfig({ NODE_ENV: 'test', ADMIN_PASSWORD_HASH: '', API_KEYS: '', PORT: '' });
    assert.equal(config.admin.enabled, false);
    assert.equal(config.port, 3000);
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

  it('ne relance pas le scraping pendant le délai après un échec', async () => {
    let calls = 0;
    let now = 1_000_000;
    const db = memoryDb({ value: payload, updatedAt: now - 120_000 });
    const cache = createCoursCache({
      db,
      scraper: async () => {
        calls += 1;
        throw new Error('réseau indisponible');
      },
      logger: null,
      ttlMs: 60_000,
      maxStaleMs: 3_600_000,
      failureCooldownMs: 30_000,
      now: () => now
    });

    assert.equal((await cache.get()).source, 'stale');
    assert.equal((await cache.get()).source, 'stale');
    assert.equal(calls, 1);

    now += 31_000;
    await cache.get();
    assert.equal(calls, 2);
  });

  it('propage l’erreur pendant le délai quand il n’y a pas de secours', async () => {
    let calls = 0;
    const cache = createCoursCache({
      db: memoryDb(null),
      scraper: async () => {
        calls += 1;
        throw new Error('réseau indisponible');
      },
      logger: null,
      ttlMs: 60_000,
      maxStaleMs: 3_600_000,
      now: () => 1_000_000
    });

    await assert.rejects(() => cache.get(), /réseau indisponible/);
    await assert.rejects(() => cache.get(), /réseau indisponible/);
    assert.equal(calls, 1);
  });

  it('force le scraping malgré le délai (rafraîchissement admin)', async () => {
    let calls = 0;
    const cache = createCoursCache({
      db: memoryDb(null),
      scraper: async () => {
        calls += 1;
        if (calls === 1) throw new Error('réseau indisponible');
        return payload;
      },
      logger: null,
      ttlMs: 60_000,
      maxStaleMs: 3_600_000,
      now: () => 1_000_000
    });

    await assert.rejects(() => cache.get(), /réseau indisponible/);
    const result = await cache.get({ force: true });
    assert.equal(result.source, 'fresh');
    assert.equal(calls, 2);
  });

  it('rafraîchit en arrière-plan uniquement quand la donnée approche de l’expiration', async () => {
    let calls = 0;
    let now = 1_000_000;
    const db = memoryDb({ value: payload, updatedAt: now - 10_000 });
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

    assert.equal(await cache.refreshIfDue({ thresholdMs: 40_000 }), false);
    assert.equal(calls, 0);

    now += 35_000;
    assert.equal(await cache.refreshIfDue({ thresholdMs: 40_000 }), true);
    assert.equal(calls, 1);
    assert.equal((await cache.get()).source, 'cache');
  });
});
