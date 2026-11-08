const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createTestContext } = require('./helpers');

function extractCsrf(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  return match ? match[1] : null;
}

const PASSWORD = 'mot-de-passe-solide-123';

describe('Comptes utilisateurs', () => {
  const ctx = createTestContext();
  const agent = request.agent(ctx.app);
  let csrf = null;

  after(() => ctx.cleanup());

  it('affiche le formulaire d’inscription avec un jeton CSRF', async () => {
    const response = await agent.get('/inscription');

    assert.equal(response.status, 200);
    assert.match(response.text, /Créer un compte/);
    csrf = extractCsrf(response.text);
    assert.ok(csrf);
    assert.match(response.headers['set-cookie'].join(';'), /brvm_csrf=/);
  });

  it('refuse une inscription sans jeton CSRF', async () => {
    const response = await request(ctx.app)
      .post('/inscription')
      .type('form')
      .send({ username: 'sanscsrf', email: 'sanscsrf@example.com', password: PASSWORD, confirm: PASSWORD });

    assert.equal(response.status, 403);
  });

  it('refuse une origine étrangère', async () => {
    const page = await agent.get('/inscription');
    const token = extractCsrf(page.text);

    const response = await agent
      .post('/inscription')
      .set('Origin', 'https://attaquant.example')
      .type('form')
      .send({
        _csrf: token,
        username: 'origine',
        email: 'origine@example.com',
        password: PASSWORD,
        confirm: PASSWORD
      });

    assert.equal(response.status, 403);
  });

  it('valide les champs du formulaire', async () => {
    const page = await agent.get('/inscription');
    const token = extractCsrf(page.text);

    const response = await agent.post('/inscription').type('form').send({
      _csrf: token,
      username: 'ab',
      email: 'pas-un-email',
      password: 'court',
      confirm: 'different'
    });

    assert.equal(response.status, 400);
    assert.match(response.text, /au moins 3 caractères/);
  });

  it('crée un compte, connecte l’utilisateur et redirige vers le compte', async () => {
    const page = await agent.get('/inscription');
    const token = extractCsrf(page.text);

    const response = await agent.post('/inscription').type('form').send({
      _csrf: token,
      username: 'Dayende',
      email: 'Dayende@Example.com',
      password: PASSWORD,
      confirm: PASSWORD
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.location, '/compte?message=bienvenue');
    assert.match(response.headers['set-cookie'].join(';'), /brvm_user=/);
  });

  it('affiche le compte et les informations du profil', async () => {
    const response = await agent.get('/compte');

    assert.equal(response.status, 200);
    assert.match(response.text, /Bonjour Dayende/);
    assert.match(response.text, /dayende@example\.com/);
    assert.match(response.text, /Aucun favori pour le moment/);
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  it('expose la session courante et un jeton CSRF', async () => {
    const response = await agent.get('/api/session');

    assert.equal(response.status, 200);
    assert.equal(response.body.authentifie, true);
    assert.equal(response.body.utilisateur.nom_utilisateur, 'Dayende');
    assert.deepEqual(response.body.favoris, []);
    assert.ok(response.body.csrf_token);
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  it('refuse un favori sans en-tête CSRF', async () => {
    const response = await agent.post('/api/favoris').send({ symbole: 'ABJC' });

    assert.equal(response.status, 403);
  });

  it('ajoute un favori via l’API', async () => {
    const session = await agent.get('/api/session');
    const response = await agent
      .post('/api/favoris')
      .set('X-CSRF-Token', session.body.csrf_token)
      .send({ symbole: 'abjc' });

    assert.equal(response.status, 200);
    assert.equal(response.body.favori, true);
    assert.deepEqual(response.body.favoris, ['ABJC']);
  });

  it('refuse un symbole inconnu', async () => {
    const session = await agent.get('/api/session');
    const response = await agent
      .post('/api/favoris')
      .set('X-CSRF-Token', session.body.csrf_token)
      .send({ symbole: 'XXXX' });

    assert.equal(response.status, 404);
  });

  it('liste le favori sur la page compte', async () => {
    const response = await agent.get('/compte');

    assert.equal(response.status, 200);
    assert.match(response.text, /ABJC/);
    assert.match(response.text, /SERVAIR ABIDJAN/);
  });

  it('retire un favori avec le formulaire du compte', async () => {
    const page = await agent.get('/compte');
    const token = extractCsrf(page.text);

    const response = await agent
      .post('/compte/favoris/retirer')
      .type('form')
      .send({ _csrf: token, symbole: 'ABJC' });

    assert.equal(response.status, 303);
    assert.equal(response.headers.location, '/compte?message=retire');

    const afterRemoval = await agent.get('/api/session');
    assert.deepEqual(afterRemoval.body.favoris, []);
  });

  it('refuse les doublons de nom d’utilisateur et d’email', async () => {
    const duplicateAgent = request.agent(ctx.app);
    const page = await duplicateAgent.get('/inscription');
    const token = extractCsrf(page.text);

    const username = await duplicateAgent.post('/inscription').type('form').send({
      _csrf: token,
      username: 'dayende',
      email: 'autre@example.com',
      password: PASSWORD,
      confirm: PASSWORD
    });
    assert.equal(username.status, 409);
    assert.match(username.text, /déjà pris/);

    const page2 = await duplicateAgent.get('/inscription');
    const token2 = extractCsrf(page2.text);
    const email = await duplicateAgent.post('/inscription').type('form').send({
      _csrf: token2,
      username: 'autrecpte',
      email: 'DAYENDE@example.com',
      password: PASSWORD,
      confirm: PASSWORD
    });
    assert.equal(email.status, 409);
    assert.match(email.text, /déjà utilisée/);
  });

  it('déconnecte l’utilisateur', async () => {
    const page = await agent.get('/compte');
    const token = extractCsrf(page.text);

    const response = await agent.post('/deconnexion').type('form').send({ _csrf: token });
    assert.equal(response.status, 303);
    assert.equal(response.headers.location, '/');

    const session = await agent.get('/api/session');
    assert.equal(session.body.authentifie, false);

    const account = await agent.get('/compte');
    assert.equal(account.status, 303);
    assert.match(account.headers.location, /^\/connexion\?next=/);
  });

  it('se connecte avec le nom d’utilisateur, sans tenir compte de la casse', async () => {
    const page = await agent.get('/connexion');
    const token = extractCsrf(page.text);

    const response = await agent
      .post('/connexion')
      .type('form')
      .send({ _csrf: token, login: 'DAYENDE', password: PASSWORD, next: '/compte#favoris' });

    assert.equal(response.status, 303);
    assert.equal(response.headers.location, '/compte#favoris');

    const session = await agent.get('/api/session');
    assert.equal(session.body.authentifie, true);
  });

  it('se connecte avec l’adresse email', async () => {
    const page = await agent.get('/compte');
    const token = extractCsrf(page.text);
    await agent.post('/deconnexion').type('form').send({ _csrf: token });

    const loginPage = await agent.get('/connexion');
    const loginToken = extractCsrf(loginPage.text);

    const response = await agent
      .post('/connexion')
      .type('form')
      .send({ _csrf: loginToken, login: 'DAYENDE@EXAMPLE.COM', password: PASSWORD });

    assert.equal(response.status, 303);
    assert.equal(response.headers.location, '/compte');
  });

  it('refuse un mauvais mot de passe avec un message générique', async () => {
    const page = await agent.get('/compte');
    const token = extractCsrf(page.text);
    await agent.post('/deconnexion').type('form').send({ _csrf: token });

    const loginPage = await agent.get('/connexion');
    const loginToken = extractCsrf(loginPage.text);

    const response = await agent
      .post('/connexion')
      .type('form')
      .send({ _csrf: loginToken, login: 'Dayende', password: 'mauvais-mot-de-passe' });

    assert.equal(response.status, 401);
    assert.match(response.text, /Identifiant ou mot de passe incorrect/);
  });
});

describe('Session anonyme', () => {
  const ctx = createTestContext();
  after(() => ctx.cleanup());

  it('renvoie une session vide mais un jeton CSRF', async () => {
    const response = await request(ctx.app).get('/api/session');

    assert.equal(response.status, 200);
    assert.equal(response.body.authentifie, false);
    assert.equal(response.body.utilisateur, null);
    assert.deepEqual(response.body.favoris, []);
    assert.ok(response.body.csrf_token);
  });

  it('refuse d’ajouter un favori sans connexion', async () => {
    const response = await request(ctx.app).post('/api/favoris').send({ symbole: 'ABJC' });

    assert.equal(response.status, 401);
    assert.match(response.body.erreur, /Connexion requise/);
  });
});

describe('Limitation des inscriptions', () => {
  const ctx = createTestContext({ env: { RATE_LIMIT_SIGNUP: '2' } });
  after(() => ctx.cleanup());

  it('bloque après plusieurs créations depuis la même IP', async () => {
    const agent = request.agent(ctx.app);

    async function attempt(index) {
      const page = await agent.get('/inscription');
      const token = extractCsrf(page.text);
      return agent.post('/inscription').type('form').send({
        _csrf: token,
        username: `compte${index}`,
        email: `compte${index}@example.com`,
        password: PASSWORD,
        confirm: PASSWORD
      });
    }

    assert.equal((await attempt(1)).status, 303);
    assert.equal((await attempt(2)).status, 303);
    assert.equal((await attempt(3)).status, 429);
  });
});
