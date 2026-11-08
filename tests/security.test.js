const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  hashApiKey,
  hashVisitor
} = require('../src/security');

test('hashPassword et verifyPassword', () => {
  const hash = hashPassword('mot-de-passe-solide');
  assert.match(hash, /^scrypt\$/);
  assert.equal(verifyPassword('mot-de-passe-solide', hash), true);
  assert.equal(verifyPassword('mauvais-mot-de-passe', hash), false);
  assert.equal(verifyPassword('mot-de-passe-solide', 'nimporte-quoi'), false);
});

test('deux hashes du même mot de passe utilisent des sels différents', () => {
  const first = hashPassword('mot-de-passe-solide');
  const second = hashPassword('mot-de-passe-solide');
  assert.notEqual(first, second);
  assert.equal(verifyPassword('mot-de-passe-solide', first), true);
  assert.equal(verifyPassword('mot-de-passe-solide', second), true);
});

test('les jetons de session sont signés et expirent', () => {
  const secret = 'secret-de-test-tres-long-0123456789';
  const now = Date.now();
  const token = createSessionToken({ username: 'admin', ttlMs: 1000, secret, now });

  assert.equal(verifySessionToken(token, secret, now + 10).sub, 'admin');
  assert.equal(verifySessionToken(token, secret, now + 5000), null);
  assert.equal(verifySessionToken(`${token}x`, secret, now + 10), null);
  assert.equal(verifySessionToken(token, 'autre-secret', now + 10), null);
  assert.equal(verifySessionToken('invalide', secret, now), null);
});

test('hashApiKey et hashVisitor sont déterministes', () => {
  assert.equal(hashApiKey('cle-api'), hashApiKey('cle-api'));
  assert.notEqual(hashApiKey('cle-api'), hashApiKey('autre-cle'));

  const first = hashVisitor('secret', '2026-11-08', '127.0.0.1', 'agent');
  const second = hashVisitor('secret', '2026-11-08', '127.0.0.1', 'agent');
  const nextDay = hashVisitor('secret', '2026-11-09', '127.0.0.1', 'agent');
  assert.equal(first, second);
  assert.notEqual(first, nextDay);
  assert.equal(first.length, 32);
});
