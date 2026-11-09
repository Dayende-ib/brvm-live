const express = require('express');
const { verifyPassword, timingSafeEqualString } = require('../security');
const { requireAdmin, verifySameOrigin } = require('../middleware/auth');
const { todayUtc } = require('../middleware/visits');
const { escapeHtml, formatDate, formatDuration } = require('../utils/html');

const DAY_MS = 24 * 60 * 60 * 1000;

function fillSeries(series, days = 30) {
  const byDay = new Map(series.map((row) => [row.jour, row]));
  const filled = [];
  const now = Date.now();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now - offset * DAY_MS).toISOString().slice(0, 10);
    filled.push(byDay.get(day) || { jour: day, vues: 0, uniques: 0 });
  }
  return filled;
}

function page({ title, body, admin = false }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/admin.css">
</head>
<body class="${admin ? 'admin-page' : 'login-page'}">
  <main class="container${admin ? '' : ' narrow'}">
    ${body}
  </main>
</body>
</html>`;
}

function loginPage({ error = '', username = '', enabled = true }) {
  const body = `
    <header class="page-header">
      <div>
        <h1>Administration</h1>
        <p class="subtitle">BRVM Live</p>
      </div>
      <a class="btn btn-ghost" href="/">Retour au site</a>
    </header>
    <section class="panel">
      ${
        enabled
          ? ''
          : '<div class="alert alert-error">Aucun mot de passe administrateur n’est configuré. Définissez ADMIN_PASSWORD_HASH dans le fichier .env puis redémarrez le service.</div>'
      }
      ${error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : ''}
      <form method="post" action="/admin/login" class="form-stack" autocomplete="on">
        <label for="username">Identifiant</label>
        <input id="username" name="username" type="text" required maxlength="100"
               value="${escapeHtml(username)}" autocomplete="username">
        <label for="password">Mot de passe</label>
        <input id="password" name="password" type="password" required maxlength="200"
               autocomplete="current-password">
        <button class="btn" type="submit"${enabled ? '' : ' disabled'}>Se connecter</button>
      </form>
      <p class="hint">Les tentatives de connexion sont limitées par IP.</p>
    </section>`;
  return page({ title: 'Connexion - BRVM Live', body });
}

function metricCard(label, value, detail = '') {
  return `
    <article class="metric">
      <p class="metric-label">${escapeHtml(label)}</p>
      <p class="metric-value">${escapeHtml(value)}</p>
      ${detail ? `<p class="metric-detail">${escapeHtml(detail)}</p>` : ''}
    </article>`;
}

function adminPage({ config, cache, db, message, csrf: rawCsrf }) {
  const status = cache.status();
  const day = todayUtc();
  const summary = db.getVisitSummary(day);
  const series = fillSeries(db.getVisitSeries(new Date(Date.now() - 29 * DAY_MS).toISOString().slice(0, 10)));
  const maxViews = Math.max(1, ...series.map((row) => row.vues));
  const recent = series.slice(-14);
  const memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const csrf = escapeHtml(rawCsrf);
  const alerts = {
    ok: '<div class="alert alert-success">Cache rafraîchi avec succès.</div>',
    stale:
      '<div class="alert alert-warning">Le rafraîchissement a échoué : les dernières données connues sont conservées.</div>',
    error: '<div class="alert alert-error">Le rafraîchissement a échoué et aucune donnée de secours n’est disponible.</div>'
  };

  const activityRows = series
    .slice()
    .reverse()
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.jour)}</td>
        <td class="number">${row.vues}</td>
        <td class="number">${row.uniques}</td>
      </tr>`
    )
    .join('');

  const body = `
    <header class="page-header">
      <div>
        <h1>Administration</h1>
        <p class="subtitle">BRVM Live · tableau de bord</p>
      </div>
      <div class="header-actions">
        <a class="btn btn-ghost" href="/">Voir le site</a>
        <form method="post" action="/admin/logout" class="inline-form">
          <input type="hidden" name="_csrf" value="${csrf}">
          <button class="btn btn-ghost" type="submit">Se déconnecter</button>
        </form>
      </div>
    </header>

    ${message ? alerts[message] || '' : ''}

    <section class="metrics" aria-label="Indicateurs">
      ${metricCard('Vues totales', String(summary.vuesTotal), 'depuis la mise en service')}
      ${metricCard('Visiteurs uniques', String(summary.uniquesTotal), 'cumul des uniques par jour')}
      ${metricCard('Aujourd’hui', String(summary.aujourdhui.vues), `${summary.aujourdhui.uniques} unique(s)`)}
      ${metricCard('Comptes', String(db.countUsers()), 'inscriptions publiques')}
      ${metricCard('Actions en cache', status.present ? String(status.actions) : '0', status.present ? `MAJ source : ${status.maj || '-'}` : 'aucune donnée')}
    </section>

    <section class="panel">
      <div class="panel-header">
        <h2>Cache des cours</h2>
        <form method="post" action="/admin/cache/refresh" class="inline-form">
          <input type="hidden" name="_csrf" value="${csrf}">
          <button class="btn" type="submit">Forcer le rafraîchissement</button>
        </form>
      </div>
      <dl class="details-grid">
        <div><dt>État</dt><dd>${status.present ? 'Données présentes' : 'Vide'}</dd></div>
        <div><dt>Dernière récupération</dt><dd>${escapeHtml(formatDate(status.updatedAt))}</dd></div>
        <div><dt>Âge</dt><dd>${escapeHtml(formatDuration(status.ageMs))}</dd></div>
        <div><dt>TTL</dt><dd>${escapeHtml(formatDuration(config.cacheTtlMs))}</dd></div>
        <div><dt>Données de secours max.</dt><dd>${escapeHtml(formatDuration(config.cacheMaxStaleMs))}</dd></div>
        <div><dt>Dernière MAJ source</dt><dd>${escapeHtml(status.maj || '-')}</dd></div>
      </dl>
    </section>

    <section class="panel">
      <h2>Fréquentation</h2>
      <ul class="bar-list">
        ${recent
          .map(
            (row) => `
          <li>
            <span class="bar-label">${escapeHtml(row.jour)}</span>
            <progress value="${row.vues}" max="${maxViews}">${row.vues}</progress>
            <span class="bar-value">${row.vues} vue(s) · ${row.uniques} unique(s)</span>
          </li>`
          )
          .join('')}
      </ul>
      <details>
        <summary>Voir les 30 derniers jours</summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Jour</th><th>Vues</th><th>Uniques</th></tr></thead>
            <tbody>${activityRows}</tbody>
          </table>
        </div>
      </details>
    </section>

    <section class="panel">
      <h2>Système et configuration</h2>
      <dl class="details-grid">
        <div><dt>Node.js</dt><dd>${escapeHtml(process.version)}</dd></div>
        <div><dt>Démarré depuis</dt><dd>${escapeHtml(formatDuration(process.uptime() * 1000))}</dd></div>
        <div><dt>Mémoire (RSS)</dt><dd>${memoryMb} Mo</dd></div>
        <div><dt>Base SQLite</dt><dd class="mono">${escapeHtml(db.file)}</dd></div>
        <div><dt>Clés API</dt><dd>${config.apiKeys.length} configurée(s)${config.apiKeysRequired ? ', obligatoires' : ', optionnelles'}</dd></div>
        <div><dt>Rétention visites</dt><dd>${config.visitsRetentionDays} jours</dd></div>
        <div><dt>Timeout scraping</dt><dd>${escapeHtml(formatDuration(config.scrapeTimeoutMs))} · ${config.scrapeRetries} retry</dd></div>
        <div><dt>Rate limit API</dt><dd>${config.rateLimits.api} anonyme / ${config.rateLimits.apiKey} avec clé par ${escapeHtml(formatDuration(config.rateLimits.windowMs))}</dd></div>
      </dl>
    </section>`;
  return page({ title: 'Administration - BRVM Live', body, admin: true });
}

function createAdminRouter({ config, cache, db, session, authCsrf, logger, limiters }) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  router.use(limiters.adminLimiter);

  router.get('/login', (req, res) => {
    if (session.read(req)) return res.redirect(303, '/admin');
    return res.status(200).type('html').send(loginPage({ enabled: config.admin.enabled }));
  });

  router.post('/login', limiters.loginLimiter, verifySameOrigin, (req, res) => {
    if (!config.admin.enabled) {
      return res.status(503).type('html').send(loginPage({ enabled: false }));
    }

    const username = typeof req.body?.username === 'string' ? req.body.username.slice(0, 100) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';

    const usernameOk = timingSafeEqualString(username, config.admin.username);
    const passwordOk = verifyPassword(password, config.admin.passwordHash);

    if (!usernameOk || !passwordOk) {
      logger?.warn('Échec de connexion admin', { ip: req.ip, username });
      return res.status(401).type('html').send(loginPage({ error: 'Identifiant ou mot de passe incorrect.', username }));
    }

    session.create(res);
    logger?.info('Connexion admin réussie', { ip: req.ip });
    return res.redirect(303, '/admin');
  });

  router.use(requireAdmin(session));

  router.post('/logout', verifySameOrigin, authCsrf.verify, (req, res) => {
    session.clear(res);
    return res.redirect(303, '/admin/login');
  });

  router.post('/cache/refresh', verifySameOrigin, authCsrf.verify, async (req, res, next) => {
    try {
      const result = await cache.get({ force: true });
      return res.redirect(303, `/admin?refresh=${result.stale ? 'stale' : 'ok'}`);
    } catch (error) {
      logger?.error('Rafraîchissement manuel échoué', { error: error.message });
      if (req.accepts('html')) return res.redirect(303, '/admin?refresh=error');
      return next(error);
    }
  });

  router.get('/', (req, res) => {
    const message = typeof req.query.refresh === 'string' ? req.query.refresh : '';
    return res.status(200).type('html').send(
      adminPage({
        config,
        cache,
        db,
        message,
        // Jeton CSRF signé et indépendant du cookie de session (qui ne doit jamais finir dans le HTML).
        csrf: authCsrf.ensure(req, res)
      })
    );
  });

  return router;
}

module.exports = { createAdminRouter };
