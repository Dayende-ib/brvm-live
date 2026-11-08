const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createTestContext } = require('./helpers');

function extractCsrf(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  return match ? match[1] : null;
}

describe('Administration', () => {
  const ctx = createTestContext();
  const agent = request.agent(ctx.app);
  after(() => ctx.cleanup());

  it('redirige vers la connexion sans session', async () => {
    const response = await request(ctx.app).get('/admin');
    assert.equal(response.status, 303);
    assert.equal(response.headers.location, '/admin/login');
  });

  it('affiche la page de connexion', async () => {
    const response = await agent.get('/admin/login');
    assert.equal(response.status, 200);
    assert.match(response.text, /Se connecter/);
  });

  it('refuse un mauvais mot de passe', async () => {
    const response = await agent
      .post('/admin/login')
      .type('form')
      .send({ username: 'admin', password: 'mauvais-mot-de-passe' });

    assert.equal(response.status, 401);
    assert.match(response.text, /incorrect/);
  });

  it('refuse une origine différente', async () => {
    const response = await agent
      .post('/admin/login')
      .set('Origin', 'https://attaquant.example')
      .type('form')
      .send({ username: 'admin', password: 'mot-de-passe-de-test-123' });

    assert.equal(response.status, 403);
  });

  it('connecte l’administrateur et affiche le tableau de bord', async () => {
    const login = await agent
      .post('/admin/login')
      .type('form')
      .send({ username: 'admin', password: 'mot-de-passe-de-test-123' });

    assert.equal(login.status, 303);
    assert.equal(login.headers.location, '/admin');

    const dashboard = await agent.get('/admin');
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.text, /Administration/);
    assert.match(dashboard.text, /Cache des cours/);
    assert.match(dashboard.text, /Fréquentation/);
    assert.equal(dashboard.headers['cache-control'], 'no-store');
  });

  it('protège les actions POST par un jeton CSRF', async () => {
    const dashboard = await agent.get('/admin');
    const csrf = extractCsrf(dashboard.text);
    assert.ok(csrf);

    const withoutToken = await agent.post('/admin/cache/refresh');
    assert.equal(withoutToken.status, 403);

    const withToken = await agent.post('/admin/cache/refresh').type('form').send({ _csrf: csrf });
    assert.equal(withToken.status, 303);
    assert.match(withToken.headers.location, /refresh=ok/);
  });

  it('déconnecte l’administrateur', async () => {
    const dashboard = await agent.get('/admin');
    const csrf = extractCsrf(dashboard.text);

    const logout = await agent.post('/admin/logout').type('form').send({ _csrf: csrf });
    assert.equal(logout.status, 303);

    const afterLogout = await agent.get('/admin');
    assert.equal(afterLogout.status, 303);
  });
});

describe('Administration désactivée', () => {
  const ctx = createTestContext({ env: { ADMIN_PASSWORD: undefined } });
  after(() => ctx.cleanup());

  it('indique qu’aucun mot de passe n’est configuré', async () => {
    const response = await request(ctx.app).get('/admin/login');
    assert.equal(response.status, 200);
    assert.match(response.text, /Aucun mot de passe administrateur/);
  });

  it('refuse la connexion', async () => {
    const response = await request(ctx.app)
      .post('/admin/login')
      .type('form')
      .send({ username: 'admin', password: 'quelque-chose' });
    assert.equal(response.status, 503);
  });
});

describe('Limitation des tentatives de connexion', () => {
  const ctx = createTestContext({ env: { RATE_LIMIT_LOGIN: '2' } });
  after(() => ctx.cleanup());

  it('bloque après plusieurs échecs', async () => {
    const attempt = () =>
      request(ctx.app)
        .post('/admin/login')
        .type('form')
        .send({ username: 'admin', password: 'mauvais' });

    assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 429);
  });
});
