const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { escapeHtml, formatDuration } = require('../utils/html');
const seo = require('../seo');
const { performance, priceChart, formatDay } = require('../history');
const { verifySameOrigin } = require('../middleware/auth');
const { OPT_OUT_COOKIE } = require('../middleware/visits');

const CONTACT_EMAIL = 'Dayende.ib@gmail.com';
const OPT_OUT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function privacyPage({ config, optedOut, notice }) {
  const days = config.visitsRetentionDays;
  const alert =
    notice === 'refusee'
      ? '<div class="alert alert-success" role="status">C’est noté : vos visites ne sont plus mesurées sur ce navigateur.</div>'
      : notice === 'acceptee'
        ? '<div class="alert alert-success" role="status">Merci : la mesure d’audience est réactivée sur ce navigateur.</div>'
        : '';

  return `
    <section class="hero">
      <p class="eyebrow">Vos données</p>
      <h1>Confidentialité</h1>
      <p class="lede">Ce que BRVM Live collecte, pourquoi, combien de temps, et comment vous y opposer.</p>
    </section>

    <section class="panel prose" aria-labelledby="responsable-title">
      <h2 id="responsable-title">Responsable du traitement</h2>
      <p>
        BRVM Live est édité par Dayende. Pour toute question ou pour exercer vos droits :
        <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. Aucune donnée n’est vendue, louée ni
        partagée avec des annonceurs ; le site n’utilise aucun outil de suivi tiers.
      </p>
    </section>

    <section class="panel prose" id="mesure" aria-labelledby="mesure-title">
      <h2 id="mesure-title">Mesure d’audience</h2>
      ${alert}
      <p>
        Pour savoir combien de personnes consultent le site et d’où elles viennent, nous enregistrons
        pour chaque page vue : la page, le jour, la <strong>source</strong> (accès direct, nom du site
        ou du moteur de recherche d’origine, paramètres de campagne <code>utm_*</code>), le
        <strong>pays</strong> déduit de l’adresse IP, et la <strong>famille</strong> d’appareil,
        de navigateur et de système (par exemple « Mobile, Chrome, Android »).
      </p>
      <p>
        Nous ne conservons <strong>ni l’adresse IP, ni l’identifiant complet du navigateur, ni l’adresse
        exacte de la page d’origine</strong>, et ne déposons aucun cookie de mesure. Pour compter les
        visiteurs uniques, une empreinte chiffrée et tronquée est calculée à partir de l’IP et du navigateur
        avec une clé secrète ; elle change chaque jour et ne permet ni de vous identifier ni de vous
        suivre d’un jour à l’autre. Ces données sont consultées uniquement sous forme de statistiques
        agrégées et supprimées après <strong>${days} jours</strong>.
      </p>
      <p>
        Les visites ne sont pas mesurées si votre navigateur envoie le signal « Do Not Track » ou
        « Global Privacy Control », ni si vous refusez ci-dessous.
      </p>
      <form method="post" action="/confidentialite/mesure" class="inline-form">
        <input type="hidden" name="choix" value="${optedOut ? 'accepter' : 'refuser'}">
        <p>
          État sur ce navigateur : <strong>${optedOut ? 'mesure refusée' : 'mesure active'}</strong>.
          <button class="btn ${optedOut ? '' : 'btn-ghost'} btn-sm" type="submit">
            ${optedOut ? 'Réactiver la mesure' : 'Refuser la mesure d’audience'}
          </button>
        </p>
      </form>
      <p class="muted small">
        Le refus est mémorisé par un cookie technique (<code>${OPT_OUT_COOKIE}</code>, 1 an), qui ne contient
        aucune donnée personnelle. Géolocalisation du pays :
        <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">IP Geolocation by DB-IP</a>.
      </p>
    </section>

    <section class="panel prose" aria-labelledby="comptes-title">
      <h2 id="comptes-title">Comptes utilisateurs</h2>
      <p>
        La création d’un compte est facultative. Nous conservons votre nom d’utilisateur, votre adresse
        email, votre mot de passe sous forme chiffrée (scrypt, jamais en clair), vos actions favorites et
        les dates de création et de dernière connexion. Ces données servent uniquement à faire fonctionner
        votre compte ; l’adresse email n’est utilisée pour aucun envoi commercial.
      </p>
      <p>
        Elles sont conservées tant que le compte existe. Vous pouvez changer de mot de passe, fermer vos
        sessions ouvertes ou <strong>supprimer définitivement votre compte</strong> à tout moment depuis
        <a href="/compte#securite">Mon compte</a>.
      </p>
    </section>

    <section class="panel prose" aria-labelledby="cookies-title">
      <h2 id="cookies-title">Cookies</h2>
      <p>Le site n’utilise que des cookies techniques, nécessaires à son fonctionnement :</p>
      <ul>
        <li><code>brvm_user</code> : maintient votre connexion (si vous avez un compte).</li>
        <li><code>brvm_csrf</code> : protège les formulaires contre les requêtes frauduleuses.</li>
        <li><code>brvm_admin</code> : session de l’administrateur du site.</li>
        <li><code>${OPT_OUT_COOKIE}</code> : mémorise votre refus de la mesure d’audience.</li>
      </ul>
    </section>

    <section class="panel prose" aria-labelledby="droits-title">
      <h2 id="droits-title">Vos droits</h2>
      <p>
        Vous disposez d’un droit d’accès, de rectification, d’effacement et d’opposition sur vos données.
        Écrivez à <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> ; nous répondons sous 30 jours.
        Vous pouvez aussi saisir l’autorité de protection des données de votre pays (par exemple la CIL
        au Burkina Faso, l’ARTCI en Côte d’Ivoire ou la CDP au Sénégal).
      </p>
      <p class="muted small">
        Les données de mesure d’audience étant anonymes et non reliables à une personne, elles ne peuvent
        pas être retrouvées individuellement pour une demande d’accès.
      </p>
    </section>`;
}

const VIEWS_DIR = path.join(__dirname, '..', 'views');
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const SYMBOL_PATTERN = /^[A-Za-z0-9.-]{1,20}$/;

// Remplace les {{cle}} d'un modèle. Les valeurs sont insérées telles quelles :
// elles doivent déjà être échappées (ou être du HTML généré par le serveur).
function render(template, values) {
  return template.replace(/{{(\w+)}}/g, (_, key) => values[key] ?? '');
}

function brandMark() {
  return `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <rect x="3" y="18" width="5" height="10" rx="1.5"></rect>
          <rect x="11" y="11" width="5" height="17" rx="1.5"></rect>
          <rect x="19" y="5" width="5" height="23" rx="1.5"></rect>
          <path d="M4 14 L12 8 L20 10 L28 3" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>`;
}

function layout({ head, body }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#020617">
  ${head}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <a class="skip-link" href="#contenu">Aller au contenu</a>

  <header class="topbar">
    <div class="container topbar-inner">
      <a class="brand" href="/" aria-label="BRVM Live, accueil">
        ${brandMark()}
        <span>BRVM <strong>Live</strong></span>
      </a>

      <nav class="topnav" aria-label="Navigation principale">
        <a href="/">Cours</a>
        <a href="/api.html">API</a>
      </nav>

      <div class="topbar-auth" data-auth-area>
        <a class="btn btn-ghost btn-sm" href="/connexion">Connexion</a>
        <a class="btn btn-sm" href="/inscription">Créer un compte</a>
      </div>
    </div>
  </header>

  <main id="contenu" class="container">
    ${body}

    <footer class="footer">
      <p>
        Données indicatives, pas un conseil en investissement. Source :
        <a href="${seo.SOURCE_URL}" target="_blank" rel="noopener noreferrer">brvm.org</a>
        · <a href="/api.html">Documentation API</a> · <a href="/confidentialite">Confidentialité</a>.
      </p>
      <p>Par <a href="https://ibrahimdayende.me" target="_blank" rel="noopener noreferrer">Dayende</a></p>
    </footer>
  </main>

  <script src="/session.js" defer></script>
</body>
</html>`;
}

function rank(actions, symbole, key) {
  const sorted = actions
    .filter((action) => typeof action[key] === 'number')
    .sort((a, b) => b[key] - a[key]);
  const index = sorted.findIndex((action) => action.symbole === symbole);
  return index === -1 ? null : { position: index + 1, total: sorted.length };
}

function trendSentence(action) {
  const variation = action.variation_pct;
  if (typeof variation !== 'number') return 'sa variation n’est pas disponible pour cette séance';
  if (variation === 0) return 'stable par rapport à la veille';
  return `en ${variation > 0 ? 'hausse' : 'baisse'} de ${seo.formatNumber(Math.abs(variation))} % par rapport à la veille`;
}

function historySection({ action, history }) {
  const symbole = escapeHtml(action.symbole);

  if (history.length < 2) {
    const since = history[0] ? ` depuis le ${escapeHtml(formatDay(history[0].day))}` : '';
    return `
    <section class="panel prose" aria-labelledby="historique-title">
      <h2 id="historique-title">Historique du cours de ${symbole}</h2>
      <p class="muted">
        L’historique de ${symbole} est enregistré${since}, une fois par séance.
        Le graphique et les performances apparaîtront dès la prochaine séance.
      </p>
    </section>`;
  }

  const perf = performance(history);
  const badge = (value) =>
    `<span class="badge ${seo.variationClass(value)}">${seo.formatVariation(value)}</span>`;
  const periodRows = perf.periods
    .filter((period) => period.variation !== null)
    .map(
      (period) => `<tr>
            <th scope="row">${escapeHtml(period.label)}</th>
            <td class="numeric">${badge(period.variation)}</td>
          </tr>`
    );
  periodRows.push(`<tr>
            <th scope="row">Depuis le ${escapeHtml(formatDay(perf.since.day))}</th>
            <td class="numeric">${badge(perf.since.variation)}</td>
          </tr>`);

  const recent = history
    .slice(-15)
    .reverse()
    .map(
      (row) => `<tr>
            <td>${escapeHtml(formatDay(row.day))}</td>
            <td class="numeric">${seo.formatNumber(row.cloture)}</td>
            <td class="numeric">${badge(row.variation_pct)}</td>
            <td class="numeric">${seo.formatVolume(row.volume)}</td>
          </tr>`
    )
    .join('\n          ');

  return `
    <section class="panel" aria-labelledby="historique-title">
      <div class="panel-head">
        <div>
          <h2 id="historique-title">Historique du cours de ${symbole}</h2>
          <p class="muted small">Clôture en FCFA, ${perf.since.sessions} séances depuis le ${escapeHtml(formatDay(perf.since.day))}.</p>
        </div>
      </div>
      <div class="chart-wrap">
        ${priceChart(history, { symbole: action.symbole })}
      </div>

      <div class="history-grid">
        <div>
          <h3>Performance</h3>
          <div class="table-wrap">
            <table>
              <caption class="visually-hidden">Performance de ${symbole} par période</caption>
              <tbody>
          ${periodRows.join('\n          ')}
              </tbody>
            </table>
          </div>
          <p class="muted small">
            Plus haut : <strong>${seo.formatNumber(perf.since.high)} FCFA</strong> ·
            plus bas : <strong>${seo.formatNumber(perf.since.low)} FCFA</strong> (en clôture, sur la période).
          </p>
        </div>

        <div>
          <h3>Dernières séances</h3>
          <div class="table-wrap">
            <table>
              <caption class="visually-hidden">Dernières séances de ${symbole}</caption>
              <thead>
                <tr>
                  <th scope="col">Séance</th>
                  <th scope="col" class="numeric">Clôture</th>
                  <th scope="col" class="numeric">Variation</th>
                  <th scope="col" class="numeric">Volume</th>
                </tr>
              </thead>
              <tbody>
          ${recent}
              </tbody>
            </table>
          </div>
          <p class="muted small">
            Historique complet en <a href="/api/historique?symbole=${encodeURIComponent(action.symbole)}">JSON</a>
            ou en <a href="/api/historique?symbole=${encodeURIComponent(action.symbole)}&amp;format=csv">CSV</a>.
          </p>
        </div>
      </div>
    </section>`;
}

function actionPage({ action, actions, data, updatedAt, history = [] }) {
  const name = action.nom || action.symbole;
  const variationRank = rank(actions, action.symbole, 'variation_pct');
  const volumeRank = rank(actions, action.symbole, 'volume');
  const majLabel = data.maj ? ` (mise à jour BRVM : ${data.maj})` : '';
  const others = actions
    .filter((other) => other.symbole !== action.symbole)
    .sort((a, b) => a.symbole.localeCompare(b.symbole, 'fr'));

  const card = (label, value, detail, className = '') => `
        <article class="metric">
          <p class="metric-label">${escapeHtml(label)}</p>
          <p class="metric-value${className}">${value}</p>
          <p class="metric-detail">${escapeHtml(detail)}</p>
        </article>`;

  const ranks = [
    variationRank &&
      `<li><strong>${variationRank.position}<sup>e</sup></strong> sur ${variationRank.total} pour la variation du jour</li>`,
    volumeRank &&
      `<li><strong>${volumeRank.position}<sup>e</sup></strong> sur ${volumeRank.total} pour le volume échangé</li>`
  ].filter(Boolean);

  return `
    <nav class="breadcrumb" aria-label="Fil d’Ariane">
      <ol>
        <li><a href="/">Cours BRVM</a></li>
        <li aria-current="page">${escapeHtml(action.symbole)}</li>
      </ol>
    </nav>

    <section class="hero">
      <p class="eyebrow">Action cotée à la BRVM · ${escapeHtml(action.symbole)}</p>
      <h1>${escapeHtml(name)} (${escapeHtml(action.symbole)})</h1>
      <p class="lede">
        Cours de l’action ${escapeHtml(name)} à la Bourse Régionale des Valeurs Mobilières
        lors de la dernière séance${escapeHtml(majLabel)}.
      </p>
    </section>

    <section class="metrics" aria-label="Chiffres clés de ${escapeHtml(action.symbole)}">
      ${card('Clôture', `${seo.formatNumber(action.cloture)} <span class="unit">FCFA</span>`, 'dernier cours')}
      ${card(
        'Variation',
        `<span class="badge ${seo.variationClass(action.variation_pct)}">${seo.formatVariation(action.variation_pct)}</span>`,
        'par rapport à la veille'
      )}
      ${card('Volume', seo.formatVolume(action.volume), 'titres échangés')}
      ${card('Cours veille', `${seo.formatNumber(action.cours_veille)} <span class="unit">FCFA</span>`, `ouverture : ${seo.formatNumber(action.ouverture)} FCFA`)}
    </section>

    <section class="panel prose" aria-labelledby="resume-title">
      <h2 id="resume-title">Résumé de la séance</h2>
      <p>
        Lors de la dernière séance, l’action <strong>${escapeHtml(name)}</strong>
        (symbole ${escapeHtml(action.symbole)}) a clôturé à
        <strong>${seo.formatNumber(action.cloture)} FCFA</strong>, ${trendSentence(action)}
        (cours de la veille : ${seo.formatNumber(action.cours_veille)} FCFA).
        ${typeof action.volume === 'number' ? `${seo.formatVolume(action.volume)} titres ont été échangés.` : ''}
      </p>
      ${ranks.length ? `<p>Parmi les ${actions.length} actions cotées ce jour-là, ${escapeHtml(action.symbole)} se classe :</p><ul>${ranks.join('')}</ul>` : ''}
      <p class="muted small">
        Données récupérées le ${escapeHtml(seo.formatDateTime(updatedAt))} depuis
        <a href="${seo.SOURCE_URL}" target="_blank" rel="noopener noreferrer">brvm.org</a>.
        Également disponibles en <a href="/api/cours?symbole=${encodeURIComponent(action.symbole)}">JSON</a>.
      </p>
      <p><a class="btn btn-ghost" href="/">Voir toutes les actions de la BRVM</a></p>
    </section>

    ${historySection({ action, history })}

    <section class="panel" aria-labelledby="autres-title">
      <h2 id="autres-title">Autres actions de la BRVM</h2>
      <ul class="symbol-list">
        ${others
          .map(
            (other) =>
              `<li><a href="${seo.actionPath(other.symbole)}"><strong>${escapeHtml(other.symbole)}</strong> <span>${escapeHtml(other.nom)}</span></a></li>`
          )
          .join('\n        ')}
      </ul>
    </section>`;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createPagesRouter({ config, cache, db }) {
  const router = express.Router();
  const templates = new Map();

  // En production les modèles sont lus une seule fois ; en développement à chaque requête.
  function template(name) {
    if (config.isProduction && templates.has(name)) return templates.get(name);
    const content = fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');
    if (config.isProduction) templates.set(name, content);
    return content;
  }

  function sendHtml(res, status, html) {
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(status).type('html').send(html);
  }

  function snapshot() {
    const result = cache.peek();
    if (!result || !Array.isArray(result.data?.actions)) return null;
    return result;
  }

  router.get('/', (req, res) => {
    const baseUrl = seo.siteUrl(config, req);
    const result = snapshot();
    const actions = result?.data.actions ?? [];
    const total = actions.length;

    const head = seo.headTags({
      title: 'Cours BRVM en direct : toutes les actions de la Bourse d’Abidjan | BRVM Live',
      description:
        `Cours de clôture, variations et volumes des ${total || ''} actions cotées à la BRVM ` +
        '(Bourse Régionale des Valeurs Mobilières), mis à jour automatiquement. Export CSV et API gratuite.',
      url: `${baseUrl}/`,
      structuredData: seo.homeStructuredData({ baseUrl, updatedAt: result?.updatedAt, total })
    });

    return sendHtml(
      res,
      200,
      render(template('index.html'), {
        head,
        total: total ? String(total) : '',
        ttl: escapeHtml(formatDuration(config.cacheTtlMs)),
        metrics: total ? seo.marketMetrics(actions) : '',
        updated: result ? escapeHtml(`Dernière récupération : ${seo.formatDateTime(result.updatedAt)}`) : '-',
        count: total ? `${total} actions` : '',
        rows: seo.actionRows(actions)
      })
    );
  });

  router.get('/index.html', (req, res) => res.redirect(301, '/'));

  router.get('/api.html', (req, res) => {
    const baseUrl = seo.siteUrl(config, req);
    const head = seo.headTags({
      title: 'API gratuite des cours de la BRVM (JSON et CSV) | BRVM Live',
      description:
        'Documentation de l’API BRVM Live : cours des actions de la BRVM en JSON ou CSV, paramètres, ' +
        'clés API, quotas et exemples (cURL, JavaScript, Python, Google Sheets).',
      url: `${baseUrl}/api.html`,
      structuredData: [
        seo.breadcrumbLd(baseUrl, [
          { name: 'Cours BRVM', path: '/' },
          { name: 'Documentation API', path: '/api.html' }
        ])
      ]
    });
    return sendHtml(res, 200, render(template('api.html'), { head }));
  });

  router.get('/action/:symbole', (req, res) => {
    const raw = req.params.symbole;
    if (!SYMBOL_PATTERN.test(raw)) {
      return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
    }

    // Une seule URL par action (canonique en majuscules).
    const symbole = raw.toUpperCase();
    if (raw !== symbole) return res.redirect(301, seo.actionPath(symbole));

    const result = snapshot();
    if (!result) {
      res.setHeader('Retry-After', '120');
      return res.status(503).sendFile(path.join(PUBLIC_DIR, '500.html'));
    }

    const { actions } = result.data;
    const action = actions.find((item) => item.symbole.toUpperCase() === symbole);
    if (!action) return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));

    const baseUrl = seo.siteUrl(config, req);
    const url = `${baseUrl}${seo.actionPath(action.symbole)}`;
    const name = action.nom || action.symbole;
    const description =
      `Cours de l’action ${name} (${action.symbole}) à la BRVM : clôture ${seo.formatNumber(action.cloture)} FCFA ` +
      `(${seo.formatVariation(action.variation_pct)}), volume ${seo.formatVolume(action.volume)} titres. ` +
      'Mis à jour automatiquement depuis brvm.org.';

    const head = seo.headTags({
      title: `${action.symbole} : cours de l’action ${name} | BRVM Live`,
      description,
      url,
      type: 'article',
      structuredData: [
        seo.breadcrumbLd(baseUrl, [
          { name: 'Cours BRVM', path: '/' },
          { name: action.symbole, path: seo.actionPath(action.symbole) }
        ]),
        {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: `${action.symbole} : cours de l’action ${name}`,
          description,
          url,
          inLanguage: 'fr',
          dateModified: new Date(result.updatedAt).toISOString(),
          isPartOf: { '@type': 'WebSite', name: seo.SITE_NAME, url: `${baseUrl}/` }
        }
      ]
    });

    return sendHtml(
      res,
      200,
      layout({
        head,
        body: actionPage({
          action,
          actions,
          data: result.data,
          updatedAt: result.updatedAt,
          history: db.getQuoteHistory(action.symbole)
        })
      })
    );
  });

  router.get('/confidentialite', (req, res) => {
    const baseUrl = seo.siteUrl(config, req);
    const head = seo.headTags({
      title: 'Confidentialité et données personnelles | BRVM Live',
      description:
        'Données collectées par BRVM Live (mesure d’audience anonyme, comptes), durée de conservation, ' +
        'cookies et exercice de vos droits.',
      url: `${baseUrl}/confidentialite`
    });
    const notice = typeof req.query.mesure === 'string' ? req.query.mesure : '';
    return sendHtml(
      res,
      200,
      layout({
        head,
        body: privacyPage({ config, optedOut: req.cookies?.[OPT_OUT_COOKIE] === '1', notice })
      })
    );
  });

  router.post('/confidentialite/mesure', verifySameOrigin, (req, res) => {
    const options = {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      path: '/'
    };
    if (req.body?.choix === 'accepter') {
      res.clearCookie(OPT_OUT_COOKIE, options);
      return res.redirect(303, '/confidentialite?mesure=acceptee#mesure');
    }
    res.cookie(OPT_OUT_COOKIE, '1', { ...options, maxAge: OPT_OUT_MAX_AGE_MS });
    return res.redirect(303, '/confidentialite?mesure=refusee#mesure');
  });

  router.get('/robots.txt', (req, res) => {
    const baseUrl = seo.siteUrl(config, req);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.type('text/plain').send(
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /compte',
        '',
        `Sitemap: ${baseUrl}/sitemap.xml`,
        ''
      ].join('\n')
    );
  });

  router.get('/sitemap.xml', (req, res) => {
    const baseUrl = seo.siteUrl(config, req);
    const result = snapshot();
    const lastmod = result ? new Date(result.updatedAt).toISOString() : null;
    const entry = (loc, withLastmod) =>
      `  <url><loc>${xmlEscape(loc)}</loc>${withLastmod && lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;

    const urls = [
      entry(`${baseUrl}/`, true),
      entry(`${baseUrl}/api.html`, false),
      ...(result?.data.actions ?? [])
        .slice()
        .sort((a, b) => a.symbole.localeCompare(b.symbole, 'fr'))
        .map((action) => entry(`${baseUrl}${seo.actionPath(action.symbole)}`, true))
    ];

    res.setHeader('Cache-Control', 'public, max-age=900');
    return res
      .type('application/xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
      );
  });

  return router;
}

module.exports = { createPagesRouter, render };
