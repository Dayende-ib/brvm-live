const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createTestContext, FIXTURE } = require('./helpers');
const { jsonLd } = require('../src/seo');

function structuredData(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((match) =>
    JSON.parse(match[1])
  );
}

describe('Référencement : page d’accueil', () => {
  const ctx = createTestContext({ env: { PUBLIC_URL: 'https://brvm.example.com/' } });
  after(() => ctx.cleanup());

  it('rend le tableau des cours côté serveur', async () => {
    const response = await request(ctx.app).get('/').set('Accept', 'text/html');

    assert.equal(response.status, 200);
    assert.ok(!response.text.includes('{{'), 'aucun marqueur de modèle restant');
    for (const action of FIXTURE.actions) {
      assert.match(response.text, new RegExp(`<a href="/action/${action.symbole}">${action.symbole}</a>`));
    }
    assert.match(response.text, /SONATEL/);
    assert.match(response.text, /Actions cotées/);
    assert.match(response.text, /des 3 actions cotées/);
  });

  it('expose titre, description, canonique et Open Graph', async () => {
    const response = await request(ctx.app).get('/');

    assert.match(response.text, /<title>Cours BRVM en direct/);
    assert.match(response.text, /<meta name="description" content="[^"]{50,}">/);
    assert.match(response.text, /<link rel="canonical" href="https:\/\/brvm.example.com\/">/);
    assert.match(response.text, /<meta property="og:url" content="https:\/\/brvm.example.com\/">/);
    assert.match(response.text, /<meta name="robots" content="index, follow">/);
  });

  it('fournit des données structurées WebSite et Dataset valides', async () => {
    const response = await request(ctx.app).get('/');
    const types = structuredData(response.text).map((item) => item['@type']);

    assert.deepEqual(types, ['WebSite', 'Dataset']);
    const dataset = structuredData(response.text)[1];
    assert.equal(dataset.distribution[1].contentUrl, 'https://brvm.example.com/api/cours?format=csv');
  });

  it('redirige /index.html vers /', async () => {
    const response = await request(ctx.app).get('/index.html');
    assert.equal(response.status, 301);
    assert.equal(response.headers.location, '/');
  });

  it('balise la documentation API', async () => {
    const response = await request(ctx.app).get('/api.html');
    assert.equal(response.status, 200);
    assert.match(response.text, /<link rel="canonical" href="https:\/\/brvm.example.com\/api.html">/);
    assert.ok(!response.text.includes('{{head}}'));
  });

  it('marque les réponses de l’API comme non indexables', async () => {
    const response = await request(ctx.app).get('/api/cours');
    assert.equal(response.headers['x-robots-tag'], 'noindex');
  });
});

describe('Référencement : fiches actions', () => {
  const ctx = createTestContext({ env: { PUBLIC_URL: 'https://brvm.example.com' } });
  after(() => ctx.cleanup());

  it('affiche une fiche complète et indexable', async () => {
    const response = await request(ctx.app).get('/action/SNTS');

    assert.equal(response.status, 200);
    assert.match(response.text, /<h1>SONATEL \(SNTS\)<\/h1>/);
    assert.match(response.text, /<title>SNTS : cours de l’action SONATEL \| BRVM Live<\/title>/);
    assert.match(response.text, /<link rel="canonical" href="https:\/\/brvm.example.com\/action\/SNTS">/);
    assert.match(response.text, /en baisse de 1 %/);
    assert.match(response.text, /19[\s\u00a0\u202f]800 FCFA/);
    // Liens internes vers les autres fiches
    assert.match(response.text, /href="\/action\/ABJC"/);
    assert.match(response.text, /href="\/action\/ONTBF"/);
    assert.ok(!response.text.includes('href="/action/SNTS"'), 'pas de lien vers elle-même');

    const types = structuredData(response.text).map((item) => item['@type']);
    assert.deepEqual(types, ['BreadcrumbList', 'WebPage']);
  });

  it('redirige vers l’URL canonique en majuscules', async () => {
    const response = await request(ctx.app).get('/action/snts');
    assert.equal(response.status, 301);
    assert.equal(response.headers.location, '/action/SNTS');
  });

  it('renvoie 404 pour un symbole inconnu ou invalide', async () => {
    assert.equal((await request(ctx.app).get('/action/INCONNU')).status, 404);
    assert.equal((await request(ctx.app).get('/action/%3Cscript%3E')).status, 404);
  });
});

describe('Référencement : fiches sans données', () => {
  const ctx = createTestContext({
    cache: {
      get: async () => {
        throw new Error('indisponible');
      },
      peek: () => null,
      status: () => ({ present: false, updatedAt: null, ageMs: null })
    }
  });
  after(() => ctx.cleanup());

  it('renvoie 503 temporaire plutôt qu’un 404', async () => {
    const response = await request(ctx.app).get('/action/SNTS');
    assert.equal(response.status, 503);
    assert.equal(response.headers['retry-after'], '120');
  });

  it('sert quand même la page d’accueil', async () => {
    const response = await request(ctx.app).get('/');
    assert.equal(response.status, 200);
    assert.ok(!response.text.includes('{{'));
  });
});

describe('Référencement : robots.txt et sitemap.xml', () => {
  const ctx = createTestContext({ env: { PUBLIC_URL: 'https://brvm.example.com' } });
  after(() => ctx.cleanup());

  it('sert robots.txt avec le sitemap', async () => {
    const response = await request(ctx.app).get('/robots.txt');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/plain/);
    assert.match(response.text, /Disallow: \/admin/);
    assert.match(response.text, /Sitemap: https:\/\/brvm.example.com\/sitemap.xml/);
  });

  it('liste l’accueil, la doc et chaque fiche action', async () => {
    const response = await request(ctx.app).get('/sitemap.xml');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /application\/xml/);
    assert.match(response.text, /<loc>https:\/\/brvm.example.com\/<\/loc><lastmod>/);
    assert.match(response.text, /<loc>https:\/\/brvm.example.com\/api.html<\/loc>/);
    for (const action of FIXTURE.actions) {
      assert.match(response.text, new RegExp(`/action/${action.symbole}</loc>`));
    }
  });
});

describe('Référencement : JSON-LD', () => {
  it('neutralise les balises dans les données', () => {
    const html = jsonLd({ name: '</script><script>alert(1)</script>' });
    assert.ok(!html.slice(0, -'</script>'.length).includes('</script>'));
    assert.ok(!html.includes('<script>alert'));
  });
});
