const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createTestContext, fakeCache, FIXTURE } = require('./helpers');

describe('API publique', () => {
  const ctx = createTestContext();
  after(() => ctx.cleanup());

  it('sert la page d’accueil avec les en-têtes de sécurité', async () => {
    const response = await request(ctx.app).get('/').set('Accept', 'text/html');

    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/html/);
    assert.match(response.headers['content-security-policy'], /script-src 'self'/);
    assert.match(response.text, /BRVM Live/);
  });

  it('sert la documentation API', async () => {
    const response = await request(ctx.app).get('/api.html').set('Accept', 'text/html');

    assert.equal(response.status, 200);
    assert.match(response.text, /Documentation API/);
    assert.match(response.text, /\/api\/cours\?format=csv/);
    assert.match(response.text, /X-API-Key/);
    assert.match(response.headers['content-security-policy'], /script-src 'self'/);
  });

  it('renvoie toutes les actions en JSON', async () => {
    const response = await request(ctx.app).get('/api/cours');

    assert.equal(response.status, 200);
    assert.equal(response.body.nombre, FIXTURE.actions.length);
    assert.equal(response.body.actions[0].symbole, 'ABJC');
    assert.equal(response.headers['x-data-source'], 'cache');
    assert.match(response.headers['cache-control'], /s-maxage=/);
  });

  it('filtre par symbole sans tenir compte de la casse', async () => {
    const response = await request(ctx.app).get('/api/cours?symbole=ontbf');

    assert.equal(response.status, 200);
    assert.equal(response.body.nombre, 1);
    assert.equal(response.body.actions[0].symbole, 'ONTBF');
  });

  it('renvoie 404 pour un symbole inconnu', async () => {
    const response = await request(ctx.app).get('/api/cours?symbole=XXXX');

    assert.equal(response.status, 404);
    assert.match(response.body.erreur, /introuvable/);
    assert.ok(Array.isArray(response.body.symboles_disponibles));
  });

  it('exporte le CSV avec BOM et en-tête', async () => {
    const response = await request(ctx.app).get('/api/cours?format=csv');

    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/csv/);
    assert.match(response.headers['content-disposition'], /attachment/);
    assert.ok(response.text.startsWith('\uFEFFsymbole,nom,volume'));
    assert.match(response.text, /ABJC/);
  });

  it('refuse un format inconnu', async () => {
    const response = await request(ctx.app).get('/api/cours?format=xml');

    assert.equal(response.status, 400);
    assert.equal(response.body.erreur, 'Paramètres invalides');
  });

  it('expose un healthcheck', async () => {
    const response = await request(ctx.app).get('/health');

    assert.equal(response.status, 200);
    assert.equal(response.body.statut, 'ok');
    assert.equal(response.body.base_de_donnees, 'ok');
  });

  it('compte les visites et expose les statistiques agrégées', async () => {
    const before = await request(ctx.app).get('/api/visites');
    const beforeViews = before.body.aujourd_hui.vues;

    await request(ctx.app)
      .get('/')
      .set('Accept', 'text/html')
      .set('User-Agent', 'Mozilla/5.0 (test)');

    await new Promise((resolve) => setTimeout(resolve, 30));

    const afterResponse = await request(ctx.app).get('/api/visites');
    assert.equal(afterResponse.status, 200);
    assert.equal(afterResponse.body.aujourd_hui.vues, beforeViews + 1);
    assert.ok(afterResponse.body.aujourd_hui.uniques >= 1);
    assert.ok(Array.isArray(afterResponse.body.serie_30_jours));
  });

  it('renvoie un 404 JSON pour une route API inconnue', async () => {
    const response = await request(ctx.app).get('/api/inconnu');

    assert.equal(response.status, 404);
    assert.equal(response.body.erreur, 'Endpoint non trouvé');
  });
});

describe('API avec données périmées', () => {
  const staleCache = fakeCache({ stale: true, source: 'stale', ageMs: 60 * 60 * 1000 });
  const ctx = createTestContext({ cache: staleCache });
  after(() => ctx.cleanup());

  it('sert les dernières données connues avec un avertissement', async () => {
    const response = await request(ctx.app).get('/api/cours');

    assert.equal(response.status, 200);
    assert.equal(response.body.perime, true);
    assert.equal(response.headers['x-data-source'], 'stale');
    assert.match(response.headers.warning, /stale/);
    assert.equal(response.headers['cache-control'], 'no-store');
  });
});

describe('API avec clé obligatoire', () => {
  const apiKey = 'cle-api-de-test-tres-longue-123456';
  const ctx = createTestContext({
    env: { API_KEYS: apiKey, API_KEYS_REQUIRED: 'true' }
  });
  after(() => ctx.cleanup());

  it('refuse les requêtes sans clé', async () => {
    const response = await request(ctx.app).get('/api/cours');

    assert.equal(response.status, 401);
    assert.match(response.body.erreur, /Clé API requise/);
  });

  it('accepte la clé via X-API-Key', async () => {
    const response = await request(ctx.app).get('/api/cours').set('X-API-Key', apiKey);
    assert.equal(response.status, 200);
  });

  it('accepte la clé via Authorization Bearer', async () => {
    const response = await request(ctx.app)
      .get('/api/cours')
      .set('Authorization', `Bearer ${apiKey}`);
    assert.equal(response.status, 200);
  });

  it('refuse une clé invalide', async () => {
    const response = await request(ctx.app).get('/api/cours').set('X-API-Key', 'mauvaise-cle');
    assert.equal(response.status, 401);
  });
});

describe('Erreur de scraping', () => {
  const failingCache = {
    get: async () => {
      const error = new Error('source morte');
      error.code = 'SCRAPE_FAILED';
      throw error;
    },
    status: () => ({ present: false, updatedAt: null, ageMs: null, actions: 0, maj: null })
  };
  const ctx = createTestContext({ cache: failingCache });
  after(() => ctx.cleanup());

  it('renvoie 502 sans exposer le détail interne', async () => {
    const response = await request(ctx.app).get('/api/cours');

    assert.equal(response.status, 502);
    assert.match(response.body.erreur, /indisponible/);
    assert.doesNotMatch(response.body.erreur, /source morte/);
  });
});
