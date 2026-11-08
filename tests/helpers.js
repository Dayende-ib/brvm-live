const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/logger');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

const FIXTURE = {
  source: 'https://www.brvm.org/fr/cours-actions/0',
  maj: '08/11/2026 18:30',
  scrapedAt: '2026-11-08T18:30:00.000Z',
  actions: [
    {
      symbole: 'ABJC',
      nom: "SERVAIR ABIDJAN COTE D'IVOIRE",
      volume: 3026,
      cours_veille: 3395,
      ouverture: 3400,
      cloture: 3400,
      variation_pct: 0.15
    },
    {
      symbole: 'ONTBF',
      nom: 'ONTANG',
      volume: 1000,
      cours_veille: 15000,
      ouverture: 15200,
      cloture: 15100,
      variation_pct: 0.67
    },
    {
      symbole: 'SNTS',
      nom: 'SONATEL',
      volume: null,
      cours_veille: 20000,
      ouverture: null,
      cloture: 19800,
      variation_pct: -1
    }
  ]
};

function fakeCache(overrides = {}) {
  return {
    get: async () => ({
      data: FIXTURE,
      updatedAt: Date.now(),
      ageMs: 0,
      stale: false,
      source: 'cache',
      ...overrides
    }),
    status: () => ({
      present: true,
      updatedAt: Date.now(),
      ageMs: 0,
      actions: FIXTURE.actions.length,
      maj: FIXTURE.maj
    })
  };
}

function createTestContext({ env = {}, cache = fakeCache() } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brvm-live-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    SESSION_SECRET: 'secret-de-test-suffisamment-long-pour-zod-123456',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'mot-de-passe-de-test-123',
    ...env
  });
  const logger = createLogger({ env: 'test' });
  const db = openDatabase(config.dataDir, logger);
  const app = createApp({ config, db, cache, logger });

  return {
    app,
    db,
    config,
    logger,
    dataDir,
    cleanup() {
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

module.exports = { createTestContext, fakeCache, FIXTURE };
