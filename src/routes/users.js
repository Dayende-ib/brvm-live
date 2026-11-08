const express = require('express');
const { z } = require('zod');
const { hashPassword, verifyPassword } = require('../security');
const { requireUser, verifySameOrigin, verifyApiCsrf } = require('../middleware/auth');
const { escapeHtml } = require('../utils/html');

const numberFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const longDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeZone: 'UTC'
});

let dummyHash = null;
function getDummyHash() {
  if (!dummyHash) dummyHash = hashPassword('mot-de-passe-factice-brvm-live');
  return dummyHash;
}

const signupSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, 'Le nom d’utilisateur doit contenir au moins 3 caractères.')
      .max(30, 'Le nom d’utilisateur ne peut pas dépasser 30 caractères.')
      .regex(
        /^[a-zA-Z0-9._-]+$/,
        'Le nom d’utilisateur ne peut contenir que des lettres, chiffres, points, tirets et underscores.'
      ),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Adresse email invalide.')
      .max(254, 'Adresse email trop longue.'),
    password: z
      .string()
      .min(10, 'Le mot de passe doit contenir au moins 10 caractères.')
      .max(200, 'Le mot de passe ne peut pas dépasser 200 caractères.'),
    confirm: z.string()
  })
  .refine((data) => data.password === data.confirm, {
    message: 'Les mots de passe ne correspondent pas.',
    path: ['confirm']
  });

const loginSchema = z.object({
  login: z.string().trim().min(1, 'Indiquez votre identifiant ou votre email.').max(254),
  password: z.string().min(1, 'Indiquez votre mot de passe.').max(200),
  next: z.string().max(300).optional()
});

const favoriteSchema = z.object({
  symbole: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((value) => value.toUpperCase()),
  favori: z.boolean().optional()
});

function safeNext(value) {
  if (typeof value !== 'string') return '/compte';
  if (!value.startsWith('/') || value.startsWith('//')) return '/compte';
  return value;
}

function firstIssue(error) {
  return error.issues[0]?.message || 'Données invalides.';
}

function initialOf(user) {
  return String(user.username || '?').slice(0, 1).toUpperCase();
}

function authArea(user, csrf) {
  if (!user) {
    return `
      <div class="topbar-auth" data-auth-area>
        <a class="btn btn-ghost btn-sm" href="/connexion">Connexion</a>
        <a class="btn btn-sm" href="/inscription">Créer un compte</a>
      </div>`;
  }

  return `
      <div class="topbar-auth" data-auth-area>
        <div class="user-menu" data-user-menu>
          <button class="user-trigger" type="button" aria-expanded="false" aria-controls="user-panel">
            <span class="avatar" aria-hidden="true">${escapeHtml(initialOf(user))}</span>
            <span class="user-trigger-name">${escapeHtml(user.username)}</span>
            <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </button>
          <div class="user-panel" id="user-panel" hidden>
            <p class="user-panel-meta">Connecté en tant que<br><strong>${escapeHtml(user.username)}</strong></p>
            <a class="user-panel-link" href="/compte">Mon compte</a>
            <a class="user-panel-link" href="/compte#favoris">Mes favoris</a>
            <form method="post" action="/deconnexion" class="user-panel-form">
              <input type="hidden" name="_csrf" value="${escapeHtml(csrf || '')}">
              <button class="user-panel-link" type="submit">Se déconnecter</button>
            </form>
          </div>
        </div>
      </div>`;
}

function shell({ title, description, body, current, user, csrf, bodyClass = '' }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#020617">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)} — BRVM Live</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
  <a class="skip-link" href="#contenu">Aller au contenu</a>

  <header class="topbar">
    <div class="container topbar-inner">
      <a class="brand" href="/" aria-label="BRVM Live, accueil">
        <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <rect x="3" y="18" width="5" height="10" rx="1.5"></rect>
          <rect x="11" y="11" width="5" height="17" rx="1.5"></rect>
          <rect x="19" y="5" width="5" height="23" rx="1.5"></rect>
          <path d="M4 14 L12 8 L20 10 L28 3" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
        <span>BRVM <strong>Live</strong></span>
      </a>

      <nav class="topnav" aria-label="Navigation principale">
        <a href="/"${current === 'cours' ? ' aria-current="page"' : ''}>Cours</a>
        <a href="/api.html"${current === 'api' ? ' aria-current="page"' : ''}>API</a>
        <a href="/compte"${current === 'compte' ? ' aria-current="page"' : ''}>Mon compte</a>
      </nav>

      ${authArea(user, csrf)}
    </div>
  </header>

  <main id="contenu" class="container">
    ${body}
  </main>

  <footer class="footer">
    <p>Compte BRVM Live · aucune donnée revendue.</p>
    <p><a href="/">Retour aux cours</a> · <a href="/api.html">Documentation API</a></p>
  </footer>

  <script src="/session.js" defer></script>
</body>
</html>`;
}

function formAlert(error) {
  return error ? `<div class="alert alert-error" role="alert">${escapeHtml(error)}</div>` : '';
}

function signupPage({ user, csrf, error = '', username = '', email = '' }) {
  const body = `
    <section class="auth-main">
      <div class="auth-card panel">
        <p class="eyebrow">Compte BRVM Live</p>
        <h1>Créer un compte</h1>
        <p class="auth-intro muted">
          Suivez vos actions préférées et retrouvez-les en un clic à chaque visite.
        </p>

        ${formAlert(error)}

        <form method="post" action="/inscription" class="form-stack auth-form" autocomplete="on">
          <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">

          <label for="username">Nom d’utilisateur</label>
          <input id="username" name="username" type="text" required minlength="3" maxlength="30"
                 pattern="[A-Za-z0-9._-]+" spellcheck="false"
                 value="${escapeHtml(username)}" autocomplete="username">
          <p class="field-hint">3 à 30 caractères : lettres, chiffres, points, tirets ou underscores.</p>

          <label for="email">Adresse email</label>
          <input id="email" name="email" type="email" required maxlength="254"
                 value="${escapeHtml(email)}" autocomplete="email" inputmode="email">

          <label for="password">Mot de passe</label>
          <input id="password" name="password" type="password" required minlength="10" maxlength="200"
                 autocomplete="new-password">
          <p class="field-hint">10 caractères minimum. Utilisez une phrase de passe unique.</p>

          <label for="confirm">Confirmer le mot de passe</label>
          <input id="confirm" name="confirm" type="password" required minlength="10" maxlength="200"
                 autocomplete="new-password">

          <button class="btn btn-block" type="submit">Créer mon compte</button>
        </form>

        <p class="auth-switch">Déjà un compte ? <a href="/connexion">Se connecter</a></p>
      </div>
    </section>`;

  return shell({
    title: 'Créer un compte',
    description: 'Créez un compte BRVM Live pour enregistrer vos actions favorites.',
    body,
    current: 'compte',
    user,
    csrf,
    bodyClass: 'auth-page'
  });
}

function loginPage({ user, csrf, error = '', login = '', next = '/compte' }) {
  const body = `
    <section class="auth-main">
      <div class="auth-card panel">
        <p class="eyebrow">Compte BRVM Live</p>
        <h1>Connexion</h1>
        <p class="auth-intro muted">
          Retrouvez votre compte, vos favoris et vos préférences.
        </p>

        ${formAlert(error)}

        <form method="post" action="/connexion" class="form-stack auth-form" autocomplete="on">
          <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
          <input type="hidden" name="next" value="${escapeHtml(next)}">

          <label for="login">Identifiant ou email</label>
          <input id="login" name="login" type="text" required maxlength="254" spellcheck="false"
                 value="${escapeHtml(login)}" autocomplete="username" autofocus>

          <label for="password">Mot de passe</label>
          <input id="password" name="password" type="password" required maxlength="200"
                 autocomplete="current-password">

          <button class="btn btn-block" type="submit">Se connecter</button>
        </form>

        <p class="auth-switch">Pas encore de compte ? <a href="/inscription">Créer un compte</a></p>
      </div>
    </section>`;

  return shell({
    title: 'Connexion',
    description: 'Connectez-vous à votre compte BRVM Live.',
    body,
    current: 'compte',
    user,
    csrf,
    bodyClass: 'auth-page'
  });
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return numberFormatter.format(Number(value));
}

function formatVolume(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return integerFormatter.format(Number(value));
}

function variationClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'neutral';
  return number > 0 ? 'positive' : 'negative';
}

function formatVariation(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const sign = number > 0 ? '+' : '';
  return `${sign}${numberFormatter.format(number)} %`;
}

function favoriteRows(favorites, bySymbol) {
  if (favorites.length === 0) {
    return `
      <div class="empty-state">
        <p><strong>Aucun favori pour le moment.</strong></p>
        <p class="muted">Depuis la page des cours, cliquez sur l’étoile à côté d’un symbole pour l’ajouter ici.</p>
        <a class="btn" href="/">Parcourir les actions</a>
      </div>`;
  }

  const rows = favorites
    .map((favorite) => {
      const action = bySymbol.get(favorite.symbole);
      const variation = action?.variation_pct;
      return `
        <tr>
          <td class="symbole">${escapeHtml(favorite.symbole)}</td>
          <td class="nom">${escapeHtml(action?.nom || '—')}</td>
          <td class="numeric">${formatVolume(action?.volume)}</td>
          <td class="numeric">${formatNumber(action?.cloture)}</td>
          <td class="numeric"><span class="badge ${variationClass(variation)}">${formatVariation(variation)}</span></td>
          <td class="numeric">
            <form method="post" action="/compte/favoris/retirer" class="inline-form">
              <input type="hidden" name="symbole" value="${escapeHtml(favorite.symbole)}">
              <input type="hidden" name="_csrf" value="${escapeHtml(favorite.csrf)}">
              <button class="icon-btn icon-btn-static" type="submit" aria-label="Retirer ${escapeHtml(favorite.symbole)} des favoris" title="Retirer des favoris">×</button>
            </form>
          </td>
        </tr>`;
    })
    .join('');

  return `
    <div class="table-wrap">
      <table>
        <caption class="visually-hidden">Vos actions favorites</caption>
        <thead>
          <tr>
            <th scope="col">Symbole</th>
            <th scope="col">Nom</th>
            <th scope="col" class="numeric">Volume</th>
            <th scope="col" class="numeric">Clôture</th>
            <th scope="col" class="numeric">Variation</th>
            <th scope="col" class="numeric"><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function accountPage({ user, csrf, favorites, actions = [], dataError = false, message = '' }) {
  const bySymbol = new Map(actions.map((action) => [action.symbole, action]));
  const withCsrf = favorites.map((favorite) => ({ ...favorite, csrf }));
  const alert =
    message === 'bienvenue'
      ? '<div class="alert alert-success" role="status">Bienvenue ! Votre compte est créé et vous êtes connecté.</div>'
      : message === 'retire'
        ? '<div class="alert alert-success" role="status">Action retirée de vos favoris.</div>'
        : '';

  const body = `
    <section class="account-head">
      <div>
        <p class="eyebrow">Mon compte</p>
        <h1>Bonjour ${escapeHtml(user.username)}</h1>
        <p class="lede">Gérez vos informations et retrouvez vos actions favorites.</p>
      </div>
      <div class="account-actions">
        <a class="btn btn-ghost" href="/">Voir les cours</a>
      </div>
    </section>

    ${alert}

    ${dataError ? '<div class="alert alert-warning" role="status">Les cours ne sont pas disponibles pour le moment : les favoris sont affichés sans cotation.</div>' : ''}

    <section class="metrics" aria-label="Votre activité">
      <article class="metric">
        <p class="metric-label">Favoris</p>
        <p class="metric-value">${integerFormatter.format(favorites.length)}</p>
        <p class="metric-detail">action(s) suivie(s)</p>
      </article>
      <article class="metric">
        <p class="metric-label">Membre depuis</p>
        <p class="metric-value metric-value-sm">${escapeHtml(longDateFormatter.format(new Date(user.createdAt)))}</p>
        <p class="metric-detail">compte BRVM Live</p>
      </article>
      <article class="metric">
        <p class="metric-label">Dernière connexion</p>
        <p class="metric-value metric-value-sm">${escapeHtml(longDateFormatter.format(new Date(user.lastLoginAt || user.createdAt)))}</p>
        <p class="metric-detail">${user.lastLoginAt ? 'connexion précédente' : 'première connexion'}</p>
      </article>
    </section>

    <section class="panel" id="favoris" aria-labelledby="favoris-title">
      <div class="panel-head">
        <div>
          <h2 id="favoris-title">Mes actions favorites</h2>
          <p class="muted small">Les étoiles de la page d’accueil alimentent cette liste.</p>
        </div>
        <span class="muted small">${favorites.length} favori(s)</span>
      </div>
      ${favoriteRows(withCsrf, bySymbol)}
    </section>

    <section class="panel" aria-labelledby="profil-title">
      <h2 id="profil-title">Informations du compte</h2>
      <dl class="details-grid">
        <div><dt>Nom d’utilisateur</dt><dd>${escapeHtml(user.username)}</dd></div>
        <div><dt>Adresse email</dt><dd>${escapeHtml(user.email)}</dd></div>
        <div><dt>Identifiant</dt><dd class="mono">#${user.id}</dd></div>
        <div><dt>Session</dt><dd>7 jours · cookie sécurisé</dd></div>
      </dl>
    </section>`;

  return shell({
    title: 'Mon compte',
    description: 'Votre compte BRVM Live et vos actions favorites.',
    body,
    current: 'compte',
    user,
    csrf,
    bodyClass: 'account-page'
  });
}

function createUsersRouter({ config, db, cache, session, authCsrf, limiters, logger }) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (req.path.startsWith('/inscription') || req.path.startsWith('/connexion') || req.path.startsWith('/compte')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  router.get('/inscription', (req, res) => {
    if (req.user) return res.redirect(303, '/compte');
    const csrf = authCsrf.ensure(req, res);
    return res.status(200).type('html').send(signupPage({ user: req.user, csrf }));
  });

  router.post(
    '/inscription',
    limiters.signupLimiter,
    verifySameOrigin,
    authCsrf.verify,
    (req, res) => {
      const parsed = signupSchema.safeParse(req.body);
      if (!parsed.success) {
        const csrf = authCsrf.ensure(req, res);
        return res.status(400).type('html').send(
          signupPage({
            user: req.user,
            csrf,
            error: firstIssue(parsed.error),
            username: typeof req.body?.username === 'string' ? req.body.username.slice(0, 30) : '',
            email: typeof req.body?.email === 'string' ? req.body.email.slice(0, 254) : ''
          })
        );
      }

      const { username, email, password } = parsed.data;

      try {
        if (db.findUserByUsername(username)) {
          const csrf = authCsrf.ensure(req, res);
          return res.status(409).type('html').send(
            signupPage({
              user: req.user,
              csrf,
              error: 'Ce nom d’utilisateur est déjà pris.',
              username,
              email
            })
          );
        }
        if (db.findUserByEmail(email)) {
          const csrf = authCsrf.ensure(req, res);
          return res.status(409).type('html').send(
            signupPage({
              user: req.user,
              csrf,
              error: 'Cette adresse email est déjà utilisée.',
              username,
              email
            })
          );
        }

        const id = db.createUser({
          username,
          email,
          passwordHash: hashPassword(password)
        });
        const user = { id, username, email };
        session.create(res, user);
        logger?.info('Nouveau compte utilisateur', { id, username, ip: req.ip });
        return res.redirect(303, '/compte?message=bienvenue');
      } catch (error) {
        if (/UNIQUE constraint failed/i.test(error.message)) {
          const csrf = authCsrf.ensure(req, res);
          return res.status(409).type('html').send(
            signupPage({
              user: req.user,
              csrf,
              error: 'Ce nom d’utilisateur ou cette adresse email est déjà utilisé.',
              username,
              email
            })
          );
        }
        return res.status(500).type('html').send(
          signupPage({
            user: req.user,
            csrf: authCsrf.ensure(req, res),
            error: 'Impossible de créer le compte pour le moment. Réessayez plus tard.',
            username,
            email
          })
        );
      }
    }
  );

  router.get('/connexion', (req, res) => {
    if (req.user) return res.redirect(303, '/compte');
    const csrf = authCsrf.ensure(req, res);
    return res.status(200).type('html').send(
      loginPage({ user: req.user, csrf, next: safeNext(req.query.next) })
    );
  });

  router.post(
    '/connexion',
    limiters.userLoginLimiter,
    verifySameOrigin,
    authCsrf.verify,
    (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).type('html').send(
          loginPage({
            user: req.user,
            csrf: authCsrf.ensure(req, res),
            error: firstIssue(parsed.error),
            login: typeof req.body?.login === 'string' ? req.body.login.slice(0, 254) : '',
            next: safeNext(req.body?.next)
          })
        );
      }

      const { login, password, next } = parsed.data;
      const lookup = login.includes('@') ? login.toLowerCase() : login;

      try {
        const row = db.findUserByLogin(lookup);
        const passwordOk = verifyPassword(password, row ? row.password_hash : getDummyHash());

        if (!row || !passwordOk) {
          logger?.warn('Échec de connexion utilisateur', { login, ip: req.ip });
          return res.status(401).type('html').send(
            loginPage({
              user: req.user,
              csrf: authCsrf.ensure(req, res),
              error: 'Identifiant ou mot de passe incorrect.',
              login,
              next: safeNext(next)
            })
          );
        }

        db.touchLastLogin(row.id);
        session.create(res, { id: Number(row.id), username: row.username });
        logger?.info('Connexion utilisateur réussie', { id: Number(row.id), ip: req.ip });
        return res.redirect(303, safeNext(next));
      } catch (error) {
        logger?.error('Erreur de connexion utilisateur', { error: error.message });
        return res.status(500).type('html').send(
          loginPage({
            user: req.user,
            csrf: authCsrf.ensure(req, res),
            error: 'Connexion impossible pour le moment. Réessayez plus tard.',
            login,
            next: safeNext(next)
          })
        );
      }
    }
  );

  router.post(
    '/deconnexion',
    limiters.accountLimiter,
    verifySameOrigin,
    (req, res, next) => {
      if (!req.user) {
        session.clear(res);
        return res.redirect(303, '/');
      }
      return next();
    },
    authCsrf.verify,
    (req, res) => {
      session.clear(res);
      logger?.info('Déconnexion utilisateur', { id: req.user.id, ip: req.ip });
      return res.redirect(303, '/');
    }
  );

  router.get('/compte', limiters.accountLimiter, requireUser(session), async (req, res, next) => {
    try {
      const favorites = db.listFavorites(req.user.id);
      let actions = [];
      let dataError = false;

      try {
        const result = await cache.get();
        actions = result.data.actions;
        dataError = Boolean(result.stale);
      } catch (error) {
        dataError = true;
        logger?.warn('Compte : cours indisponibles', { error: error.message });
      }

      const message = typeof req.query.message === 'string' ? req.query.message : '';
      return res.status(200).type('html').send(
        accountPage({
          user: req.user,
          csrf: authCsrf.ensure(req, res),
          favorites,
          actions,
          dataError,
          message
        })
      );
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    '/compte/favoris/retirer',
    limiters.accountLimiter,
    requireUser(session),
    verifySameOrigin,
    authCsrf.verify,
    (req, res) => {
      const parsed = favoriteSchema.safeParse(req.body);
      if (!parsed.success) return res.redirect(303, '/compte');

      db.removeFavorite(req.user.id, parsed.data.symbole);
      logger?.info('Favori retiré', { id: req.user.id, symbole: parsed.data.symbole });
      return res.redirect(303, '/compte?message=retire');
    }
  );

  router.get('/api/session', (req, res) => {
    const csrf = authCsrf.ensure(req, res);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      authentifie: Boolean(req.user),
      utilisateur: req.user
        ? {
            id: req.user.id,
            nom_utilisateur: req.user.username,
            email: req.user.email,
            cree_le: new Date(req.user.createdAt).toISOString(),
            derniere_connexion: req.user.lastLoginAt
              ? new Date(req.user.lastLoginAt).toISOString()
              : null
          }
        : null,
      favoris: req.user ? db.listFavorites(req.user.id).map((favorite) => favorite.symbole) : [],
      csrf_token: csrf
    });
  });

  router.post(
    '/api/favoris',
    limiters.accountLimiter,
    requireUser(session),
    verifySameOrigin,
    verifyApiCsrf(config),
    async (req, res) => {
      const parsed = favoriteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          erreur: 'Symbole invalide.',
          details: parsed.error.issues.map((issue) => issue.message)
        });
      }

      const { symbole, favori } = parsed.data;

      try {
        const result = await cache.get();
        const exists = result.data.actions.some(
          (action) => action.symbole.toUpperCase() === symbole
        );
        if (!exists) {
          return res.status(404).json({ erreur: `Symbole ${symbole} introuvable.` });
        }

        const current = db
          .listFavorites(req.user.id)
          .some((favorite) => favorite.symbole === symbole);
        const shouldAdd = typeof favori === 'boolean' ? favori : !current;

        if (shouldAdd) db.addFavorite(req.user.id, symbole);
        else db.removeFavorite(req.user.id, symbole);

        const favorites = db.listFavorites(req.user.id).map((item) => item.symbole);
        logger?.info(shouldAdd ? 'Favori ajouté' : 'Favori retiré', {
          id: req.user.id,
          symbole
        });

        return res.json({ symbole, favori: shouldAdd, favoris: favorites });
      } catch (error) {
        logger?.warn('Favoris : cours indisponibles', { error: error.message });
        return res.status(503).json({
          erreur: 'Les cours sont momentanément indisponibles, réessayez plus tard.'
        });
      }
    }
  );

  return router;
}

module.exports = { createUsersRouter, signupSchema, loginSchema, safeNext };
