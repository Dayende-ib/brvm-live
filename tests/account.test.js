const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createTestContext } = require('./helpers');

const PASSWORD = 'mot-de-passe-solide-123';
const NEW_PASSWORD = 'nouveau-mot-de-passe-456';

function extractCsrf(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  return match ? match[1] : null;
}

async function signup(app, username) {
  const agent = request.agent(app);
  const page = await agent.get('/inscription');
  const response = await agent.post('/inscription').type('form').send({
    _csrf: extractCsrf(page.text),
    username,
    email: `${username}@example.com`,
    password: PASSWORD,
    confirm: PASSWORD
  });
  assert.equal(response.status, 303);
  return agent;
}

async function login(app, username, password) {
  const agent = request.agent(app);
  const page = await agent.get('/connexion');
  const response = await agent.post('/connexion').type('form').send({
    _csrf: extractCsrf(page.text),
    login: username,
    password
  });
  return { agent, response };
}

async function postFromAccount(agent, path, fields) {
  const page = await agent.get('/compte');
  assert.equal(page.status, 200);
  return agent
    .post(path)
    .type('form')
    .send({ _csrf: extractCsrf(page.text), ...fields });
}

async function isLoggedIn(agent) {
  const response = await agent.get('/compte');
  return response.status === 200;
}

describe('Compte : changement de mot de passe', () => {
  const ctx = createTestContext({ env: { RATE_LIMIT_USER_LOGIN: '50' } });
  after(() => ctx.cleanup());

  it('affiche la section sécurité avec la durée de session configurée', async () => {
    const agent = await signup(ctx.app, 'securite');
    const page = await agent.get('/compte');
    assert.match(page.text, /Changer de mot de passe/);
    assert.match(page.text, /Supprimer mon compte/);
    assert.match(page.text, /7 j · cookie sécurisé/);
  });

  it('refuse un mot de passe actuel incorrect', async () => {
    const agent = await signup(ctx.app, 'mauvaisactuel');
    const response = await postFromAccount(agent, '/compte/mot-de-passe', {
      current: 'pas-le-bon-mot-de-passe',
      password: NEW_PASSWORD,
      confirm: NEW_PASSWORD
    });
    assert.equal(response.status, 401);
    assert.match(response.text, /Mot de passe actuel incorrect/);
  });

  it('valide le nouveau mot de passe', async () => {
    const agent = await signup(ctx.app, 'validation');

    const mismatch = await postFromAccount(agent, '/compte/mot-de-passe', {
      current: PASSWORD,
      password: NEW_PASSWORD,
      confirm: 'autre-chose-123456'
    });
    assert.equal(mismatch.status, 400);
    assert.match(mismatch.text, /ne correspondent pas/);

    const same = await postFromAccount(agent, '/compte/mot-de-passe', {
      current: PASSWORD,
      password: PASSWORD,
      confirm: PASSWORD
    });
    assert.equal(same.status, 400);
    assert.match(same.text, /différent/);
  });

  it('change le mot de passe et déconnecte les autres appareils', async () => {
    const agent = await signup(ctx.app, 'changement');
    const { agent: otherDevice } = await login(ctx.app, 'changement', PASSWORD);
    assert.equal(await isLoggedIn(otherDevice), true);

    const response = await postFromAccount(agent, '/compte/mot-de-passe', {
      current: PASSWORD,
      password: NEW_PASSWORD,
      confirm: NEW_PASSWORD
    });
    assert.equal(response.status, 303);
    assert.match(response.headers.location, /message=mot-de-passe/);

    assert.equal(await isLoggedIn(agent), true, 'la session courante reste valide');
    assert.equal(await isLoggedIn(otherDevice), false, 'l’autre appareil est déconnecté');

    const oldLogin = await login(ctx.app, 'changement', PASSWORD);
    assert.equal(oldLogin.response.status, 401);
    const newLogin = await login(ctx.app, 'changement', NEW_PASSWORD);
    assert.equal(newLogin.response.status, 303);
  });
});

describe('Compte : déconnexion des autres appareils', () => {
  const ctx = createTestContext();
  after(() => ctx.cleanup());

  it('révoque les autres sessions et garde la session courante', async () => {
    const agent = await signup(ctx.app, 'appareils');
    const { agent: otherDevice } = await login(ctx.app, 'appareils', PASSWORD);

    const response = await postFromAccount(agent, '/compte/sessions', {});
    assert.equal(response.status, 303);

    assert.equal(await isLoggedIn(agent), true);
    assert.equal(await isLoggedIn(otherDevice), false);
  });

  it('exige un jeton CSRF', async () => {
    const agent = await signup(ctx.app, 'sanscsrf');
    const response = await agent.post('/compte/sessions').type('form').send({});
    assert.equal(response.status, 403);
  });
});

describe('Compte : suppression', () => {
  const ctx = createTestContext({ env: { RATE_LIMIT_USER_LOGIN: '50' } });
  after(() => ctx.cleanup());

  it('exige de recopier le nom d’utilisateur', async () => {
    const agent = await signup(ctx.app, 'recopie');
    const response = await postFromAccount(agent, '/compte/supprimer', {
      username: 'autre',
      password: PASSWORD
    });
    assert.equal(response.status, 400);
    assert.match(response.text, /ne correspond pas/);
    assert.ok(ctx.db.findUserByUsername('recopie'));
  });

  it('exige le bon mot de passe', async () => {
    const agent = await signup(ctx.app, 'mauvaismdp');
    const response = await postFromAccount(agent, '/compte/supprimer', {
      username: 'mauvaismdp',
      password: 'pas-le-bon-mot-de-passe'
    });
    assert.equal(response.status, 401);
    assert.ok(ctx.db.findUserByUsername('mauvaismdp'));
  });

  it('supprime le compte, ses favoris et ses sessions', async () => {
    const agent = await signup(ctx.app, 'supprime');
    const user = ctx.db.findUserByUsername('supprime');
    ctx.db.addFavorite(user.id, 'ABJC');
    const { agent: otherDevice } = await login(ctx.app, 'supprime', PASSWORD);

    const response = await postFromAccount(agent, '/compte/supprimer', {
      username: 'SUPPRIME',
      password: PASSWORD
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.location, '/');

    assert.equal(ctx.db.findUserByUsername('supprime'), null);
    assert.deepEqual(ctx.db.listFavorites(user.id), []);
    assert.equal(await isLoggedIn(agent), false);
    assert.equal(await isLoggedIn(otherDevice), false);

    const relogin = await login(ctx.app, 'supprime', PASSWORD);
    assert.equal(relogin.response.status, 401);
  });
});

describe('Administration : jeton CSRF', () => {
  const ctx = createTestContext();
  after(() => ctx.cleanup());

  it('n’expose pas le cookie de session dans le HTML', async () => {
    const agent = request.agent(ctx.app);
    const loginResponse = await agent
      .post('/admin/login')
      .type('form')
      .send({ username: 'admin', password: 'mot-de-passe-de-test-123' });
    assert.equal(loginResponse.status, 303);

    const sessionCookie = loginResponse.headers['set-cookie']
      .find((cookie) => cookie.startsWith('brvm_admin='))
      .split(';')[0]
      .slice('brvm_admin='.length);

    const dashboard = await agent.get('/admin');
    const csrf = extractCsrf(dashboard.text);
    assert.ok(csrf);
    assert.notEqual(csrf, sessionCookie);
    assert.ok(!dashboard.text.includes(sessionCookie));
  });
});
