const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createTestContext, FIXTURE } = require('./helpers');
const { createCoursCache } = require('../src/cache');
const { parseMajDay, sessionDay, performance, priceChart } = require('../src/history');

describe('Historique : date de séance', () => {
  it('lit la date écrite en toutes lettres de brvm.org', () => {
    assert.equal(parseMajDay('Vendredi, 6 novembre, 2026 - 22:45'), '2026-11-06');
    assert.equal(parseMajDay('Lundi, 1er décembre, 2026 - 18:00'), '2026-12-01');
    assert.equal(parseMajDay('Jeudi, 13 août, 2026'), '2026-08-13');
    assert.equal(parseMajDay('mardi 3 FÉVRIER 2026'), '2026-02-03');
  });

  it('lit le format numérique', () => {
    assert.equal(parseMajDay('08/11/2026 18:30'), '2026-11-08');
  });

  it('refuse les dates impossibles ou illisibles', () => {
    assert.equal(parseMajDay('31/02/2026'), null);
    assert.equal(parseMajDay('bientôt'), null);
    assert.equal(parseMajDay(null), null);
  });

  it('se rabat sur la date de récupération', () => {
    assert.equal(sessionDay({ maj: null, scrapedAt: '2026-11-09T10:00:00.000Z' }), '2026-11-09');
  });
});

describe('Historique : performances et graphique', () => {
  const history = [
    { day: '2025-11-03', cloture: 1000 },
    { day: '2026-08-07', cloture: 1500 },
    { day: '2026-10-05', cloture: 1800 },
    { day: '2026-10-30', cloture: 1900 },
    { day: '2026-11-06', cloture: 2000 }
  ];

  it('calcule la variation par période à partir de la dernière clôture connue', () => {
    const perf = performance(history);
    const byLabel = Object.fromEntries(perf.periods.map((period) => [period.label, period.variation]));

    assert.equal(byLabel['1 semaine'], 5.26); // 1900 -> 2000
    assert.equal(byLabel['1 mois'], 11.11); // 1800 -> 2000
    assert.equal(byLabel['3 mois'], 33.33); // 1500 -> 2000
    assert.equal(byLabel['1 an'], 100); // 1000 -> 2000
    assert.equal(perf.since.high, 2000);
    assert.equal(perf.since.low, 1000);
    assert.equal(perf.since.sessions, 5);
  });

  it('ne calcule pas une période plus longue que l’historique', () => {
    const perf = performance(history.slice(-2));
    const byLabel = Object.fromEntries(perf.periods.map((period) => [period.label, period.variation]));
    assert.equal(byLabel['1 semaine'], 5.26);
    assert.equal(byLabel['1 mois'], null);
  });

  it('dessine un graphique SVG accessible', () => {
    const svg = priceChart(history, { symbole: 'SNTS' });
    assert.match(svg, /^<svg class="price-chart chart-up"/);
    assert.match(svg, /role="img"/);
    assert.match(svg, /<title id="chart-title">Évolution du cours de clôture de SNTS<\/title>/);
    assert.equal(priceChart(history.slice(0, 1), { symbole: 'SNTS' }), '');
  });
});

describe('Historique : enregistrement', () => {
  const ctx = createTestContext();
  after(() => ctx.cleanup());

  it('met à jour la ligne du jour au lieu d’en ajouter une', () => {
    ctx.db.recordQuotes('2026-11-06', [{ symbole: 'ABJC', nom: 'SERVAIR', cloture: 3400 }]);
    ctx.db.recordQuotes('2026-11-06', [{ symbole: 'ABJC', nom: 'SERVAIR', cloture: 3450 }]);
    ctx.db.recordQuotes('2026-11-09', [{ symbole: 'ABJC', nom: 'SERVAIR', cloture: 3500 }]);

    const rows = ctx.db.getQuoteHistory('ABJC');
    assert.deepEqual(
      rows.map((row) => [row.day, row.cloture]),
      [
        ['2026-11-06', 3450],
        ['2026-11-09', 3500]
      ]
    );
    assert.deepEqual(ctx.db.getHistoryStats(), { firstDay: '2026-11-06', lastDay: '2026-11-09', sessions: 2 });
  });

  it('appelle onRefresh après un scraping réussi sans propager ses erreurs', async () => {
    const calls = [];
    let row = null;
    const cache = createCoursCache({
      db: {
        getCache: () => row,
        setCache: (_key, value, updatedAt) => {
          row = { value, updatedAt };
        }
      },
      scraper: async () => FIXTURE,
      logger: null,
      ttlMs: 60_000,
      maxStaleMs: 3_600_000,
      onRefresh: (data) => {
        calls.push(data.actions.length);
        throw new Error('disque plein');
      }
    });

    const result = await cache.get();
    assert.equal(result.source, 'fresh');
    assert.deepEqual(calls, [FIXTURE.actions.length]);
  });
});

describe('Historique : fiche action et API', () => {
  const ctx = createTestContext({ env: { PUBLIC_URL: 'https://brvm.example.com' } });
  after(() => ctx.cleanup());

  it('indique que l’historique démarre quand il n’y a qu’une séance', async () => {
    ctx.db.recordQuotes('2026-11-06', FIXTURE.actions);
    const response = await request(ctx.app).get('/action/SNTS');
    assert.equal(response.status, 200);
    assert.match(response.text, /Historique du cours de SNTS/);
    assert.match(response.text, /apparaîtront dès la prochaine séance/);
    assert.ok(!response.text.includes('<svg class="price-chart'));
  });

  it('affiche graphique, performances et dernières séances', async () => {
    ctx.db.recordQuotes('2026-10-30', [{ ...FIXTURE.actions[2], cloture: 20500, variation_pct: 0.5 }]);
    ctx.db.recordQuotes('2026-11-09', [{ ...FIXTURE.actions[2], cloture: 20100, variation_pct: 1.5 }]);

    const response = await request(ctx.app).get('/action/SNTS');
    assert.match(response.text, /<svg class="price-chart/);
    assert.match(response.text, /1 semaine/);
    assert.match(response.text, /Dernières séances/);
    assert.match(response.text, /3 séances depuis le 30 oct\. 2026/);
    assert.match(response.text, /href="\/api\/historique\?symbole=SNTS&amp;format=csv"/);
  });

  it('expose l’historique en JSON', async () => {
    const response = await request(ctx.app).get('/api/historique?symbole=snts');
    assert.equal(response.status, 200);
    assert.equal(response.body.symbole, 'SNTS');
    assert.equal(response.body.nombre, 3);
    assert.equal(response.body.premiere_seance, '2026-10-30');
    assert.equal(response.body.seances[2].cloture, 20100);
    assert.equal(response.headers['x-robots-tag'], 'noindex');
  });

  it('expose l’historique en CSV', async () => {
    const response = await request(ctx.app).get('/api/historique?symbole=SNTS&format=csv');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/csv/);
    assert.ok(response.text.startsWith('﻿jour,cours_veille,ouverture,cloture,variation_pct,volume'));
    assert.match(response.text, /2026-11-09,20000,,20100,1.5,/);
  });

  it('valide les paramètres et renvoie 404 sans historique', async () => {
    assert.equal((await request(ctx.app).get('/api/historique')).status, 400);
    assert.equal((await request(ctx.app).get('/api/historique?symbole=SNTS&jours=0')).status, 400);
    assert.equal((await request(ctx.app).get('/api/historique?symbole=INCONNU')).status, 404);
  });
});
