const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createTestContext } = require('./helpers');
const { sourceOf, deviceOf, countryOf, cleanTag } = require('../src/analytics');

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const WINDOWS_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';
const BURKINA_IP = '41.138.96.1';

describe('Audience : origine des visites', () => {
  it('reconnaît les moteurs, réseaux sociaux et assistants IA', () => {
    assert.deepEqual(
      [
        sourceOf({ referer: 'https://www.google.fr/' }),
        sourceOf({ referer: 'https://gemini.google.com/app' }),
        sourceOf({ referer: 'https://l.facebook.com/' }),
        sourceOf({ referer: 'https://t.co/abc' }),
        sourceOf({ referer: 'https://chatgpt.com/' })
      ].map(({ source, sourceType }) => [source, sourceType]),
      [
        ['Google', 'search'],
        ['Gemini', 'ai'],
        ['Facebook', 'social'],
        ['X (Twitter)', 'social'],
        ['ChatGPT', 'ai']
      ]
    );
  });

  it('ne garde que le nom de domaine d’un site référent', () => {
    const origin = sourceOf({ referer: 'https://www.forum-bourse.example/discussion/42?user=jean' });
    assert.equal(origin.source, 'forum-bourse.example');
    assert.equal(origin.sourceType, 'referral');
    assert.equal(origin.referrerHost, 'forum-bourse.example');
  });

  it('distingue accès direct, navigation interne et campagnes', () => {
    assert.equal(sourceOf({}).sourceType, 'direct');
    assert.equal(
      sourceOf({ referer: 'https://brvm.example.com/action/SNTS', ownHosts: ['brvm.example.com'] }).sourceType,
      'internal'
    );
    const campaign = sourceOf({
      referer: 'https://l.facebook.com/',
      query: { utm_source: 'Newsletter', utm_medium: 'email', utm_campaign: 'Rentrée 2026' }
    });
    assert.deepEqual(
      [campaign.source, campaign.sourceType, campaign.utmMedium, campaign.utmCampaign],
      ['newsletter', 'campaign', 'email', 'rentr-e-2026']
    );
  });

  it('nettoie les paramètres UTM (aucun texte libre stocké)', () => {
    assert.equal(cleanTag('<script>alert(1)</script>'), 'script-alert-1-script');
    assert.equal(cleanTag('   '), null);
    assert.equal(cleanTag('x'.repeat(80)).length, 50);
  });
});

describe('Audience : pays et appareil', () => {
  it('déduit le pays de l’IP', () => {
    assert.equal(countryOf(BURKINA_IP), 'BF');
    assert.equal(countryOf('::ffff:8.8.8.8'), 'US');
    assert.equal(countryOf('127.0.0.1'), null);
    assert.equal(countryOf('pas-une-ip'), null);
  });

  it('ne garde que les familles d’appareil, navigateur et système', () => {
    assert.deepEqual(deviceOf(ANDROID_CHROME), { device: 'mobile', browser: 'Chrome', os: 'Android' });
    assert.deepEqual(deviceOf(WINDOWS_FIREFOX), { device: 'desktop', browser: 'Firefox', os: 'Windows' });
    assert.deepEqual(deviceOf(''), { device: null, browser: null, os: null });
  });
});

describe('Audience : enregistrement des visites', () => {
  const ctx = createTestContext({ env: { PUBLIC_URL: 'https://brvm.example.com' } });
  after(() => ctx.cleanup());

  function lastVisit() {
    return ctx.db.getAudienceBreakdown('0000-00-00', 50);
  }

  it('enregistre source, pays et appareil sans conserver l’IP ni le User-Agent', async () => {
    await request(ctx.app)
      .get('/action/SNTS')
      .set('Accept', 'text/html')
      .set('X-Forwarded-For', BURKINA_IP)
      .set('User-Agent', ANDROID_CHROME)
      .set('Referer', 'https://www.google.com/');

    const breakdown = lastVisit();
    assert.equal(breakdown.vues, 1);
    assert.deepEqual(breakdown.sources.map((row) => row.valeur), ['Google']);
    assert.deepEqual(breakdown.pays.map((row) => row.valeur), ['BF']);
    assert.deepEqual(breakdown.appareils.map((row) => row.valeur), ['mobile']);
    assert.deepEqual(breakdown.pages.map((row) => row.valeur), ['/action/SNTS']);

    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(ctx.db.file);
    const stored = JSON.stringify(raw.prepare('SELECT * FROM visits').all());
    raw.close();
    assert.ok(!stored.includes(BURKINA_IP), 'aucune IP stockée');
    assert.ok(!stored.includes('SM-A135F'), 'aucun User-Agent brut stocké');
  });

  it('ne mesure ni les pages privées, ni les robots, ni Do Not Track', async () => {
    const before = lastVisit().vues;
    await request(ctx.app).get('/connexion').set('Accept', 'text/html').set('User-Agent', WINDOWS_FIREFOX);
    await request(ctx.app).get('/').set('Accept', 'text/html').set('User-Agent', 'Googlebot/2.1');
    await request(ctx.app).get('/').set('Accept', 'text/html').set('User-Agent', WINDOWS_FIREFOX).set('DNT', '1');
    await request(ctx.app)
      .get('/')
      .set('Accept', 'text/html')
      .set('User-Agent', WINDOWS_FIREFOX)
      .set('Sec-GPC', '1');
    assert.equal(lastVisit().vues, before);
  });

  it('exclut la navigation interne des sources', async () => {
    await request(ctx.app)
      .get('/')
      .set('Accept', 'text/html')
      .set('User-Agent', WINDOWS_FIREFOX)
      .set('Referer', 'https://brvm.example.com/action/SNTS');

    const breakdown = lastVisit();
    assert.ok(!breakdown.sources.some((row) => row.valeur === 'interne'));
    assert.ok(breakdown.pages.some((row) => row.valeur === '/'));
  });

  it('respecte le refus de la mesure et permet de le retirer', async () => {
    const agent = request.agent(ctx.app);
    const refuse = await agent.post('/confidentialite/mesure').type('form').send({ choix: 'refuser' });
    assert.equal(refuse.status, 303);
    assert.match(refuse.headers['set-cookie'].join(';'), /brvm_no_stats=1/);

    const before = lastVisit().vues;
    await agent.get('/').set('Accept', 'text/html').set('User-Agent', WINDOWS_FIREFOX);
    assert.equal(lastVisit().vues, before);

    const page = await agent.get('/confidentialite');
    assert.match(page.text, /mesure refusée/);

    await agent.post('/confidentialite/mesure').type('form').send({ choix: 'accepter' });
    await agent.get('/').set('Accept', 'text/html').set('User-Agent', WINDOWS_FIREFOX);
    assert.equal(lastVisit().vues, before + 1);
  });

  it('refuse un changement de choix depuis un autre site', async () => {
    const response = await request(ctx.app)
      .post('/confidentialite/mesure')
      .set('Origin', 'https://attaquant.example')
      .type('form')
      .send({ choix: 'refuser' });
    assert.equal(response.status, 403);
  });
});

describe('Audience : tableau de bord admin', () => {
  const ctx = createTestContext();
  after(() => ctx.cleanup());

  it('affiche les répartitions avec l’attribution DB-IP', async () => {
    await request(ctx.app)
      .get('/')
      .set('Accept', 'text/html')
      .set('X-Forwarded-For', BURKINA_IP)
      .set('User-Agent', ANDROID_CHROME)
      .set('Referer', 'https://www.facebook.com/');

    const agent = request.agent(ctx.app);
    await agent.post('/admin/login').type('form').send({ username: 'admin', password: 'mot-de-passe-de-test-123' });
    const page = await agent.get('/admin?periode=7');

    assert.equal(page.status, 200);
    assert.match(page.text, /Audience/);
    assert.match(page.text, /Burkina Faso/);
    assert.match(page.text, /Facebook/);
    assert.match(page.text, /Réseaux sociaux/);
    assert.match(page.text, /Mobile/);
    assert.match(page.text, /IP Geolocation by DB-IP/);
    assert.match(page.text, /<span class="btn btn-sm" aria-current="true">7 jours<\/span>/);
  });

  it('affiche la page de confidentialité', async () => {
    const page = await request(ctx.app).get('/confidentialite');
    assert.equal(page.status, 200);
    assert.match(page.text, /Mesure d’audience/);
    assert.match(page.text, /db-ip\.com/);
    assert.match(page.text, /<link rel="canonical"/);
  });
});
