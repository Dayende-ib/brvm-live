const { escapeHtml } = require('./utils/html');

const SITE_NAME = 'BRVM Live';
const SOURCE_URL = 'https://www.brvm.org/fr/cours-actions/0';

const numberFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Africa/Abidjan'
});

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatNumber(value) {
  return isNumber(value) ? numberFormatter.format(value) : '-';
}

function formatVolume(value) {
  return isNumber(value) ? integerFormatter.format(value) : '-';
}

function formatVariation(value) {
  if (!isNumber(value)) return '-';
  return `${value > 0 ? '+' : ''}${numberFormatter.format(value)} %`;
}

function variationClass(value) {
  if (!isNumber(value) || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

function formatDateTime(ms) {
  return ms ? `${dateTimeFormatter.format(new Date(ms))} (heure d’Abidjan)` : '-';
}

// URL publique du site : PUBLIC_URL en priorité, sinon l'hôte de la requête.
function siteUrl(config, req) {
  if (config.publicUrl) return config.publicUrl;
  return `${req.protocol}://${req.get('host')}`;
}

function actionPath(symbole) {
  return `/action/${encodeURIComponent(symbole)}`;
}

// JSON-LD sûr à insérer dans le HTML (aucun "</script>" possible).
function jsonLd(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `<script type="application/ld+json">${json}</script>`;
}

function headTags({ title, description, url, type = 'website', robots = 'index, follow', structuredData = [] }) {
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta name="robots" content="${escapeHtml(robots)}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:locale" content="fr_FR">`,
    `<meta property="og:type" content="${escapeHtml(type)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    ...structuredData.map(jsonLd)
  ];
  return tags.join('\n  ');
}

function marketSummary(actions) {
  const hausses = actions.filter((action) => action.variation_pct > 0).length;
  const baisses = actions.filter((action) => action.variation_pct < 0).length;
  const volume = actions.reduce((sum, action) => sum + (isNumber(action.volume) ? action.volume : 0), 0);
  return { total: actions.length, hausses, baisses, stables: actions.length - hausses - baisses, volume };
}

function metricCard(label, value, detail) {
  return `<article class="metric">
        <p class="metric-label">${escapeHtml(label)}</p>
        <p class="metric-value">${escapeHtml(value)}</p>
        <p class="metric-detail">${escapeHtml(detail)}</p>
      </article>`;
}

function marketMetrics(actions) {
  const summary = marketSummary(actions);
  return [
    metricCard('Actions cotées', integerFormatter.format(summary.total), 'dans le tableau BRVM'),
    metricCard('Hausses', integerFormatter.format(summary.hausses), 'variation positive'),
    metricCard('Baisses', integerFormatter.format(summary.baisses), 'variation négative'),
    metricCard('Volume total', integerFormatter.format(summary.volume), 'titres échangés')
  ].join('\n      ');
}

// Lignes du tableau rendues côté serveur ; app.js les remplace ensuite (étoiles, tri, recherche).
function actionRows(actions) {
  return actions
    .slice()
    .sort((a, b) => a.symbole.localeCompare(b.symbole, 'fr'))
    .map(
      (action) => `<tr>
              <td class="symbole"><a href="${actionPath(action.symbole)}">${escapeHtml(action.symbole)}</a></td>
              <td class="nom">${escapeHtml(action.nom)}</td>
              <td class="numeric">${formatVolume(action.volume)}</td>
              <td class="numeric">${formatNumber(action.cours_veille)}</td>
              <td class="numeric">${formatNumber(action.ouverture)}</td>
              <td class="numeric">${formatNumber(action.cloture)}</td>
              <td class="numeric"><span class="badge ${variationClass(action.variation_pct)}">${formatVariation(action.variation_pct)}</span></td>
            </tr>`
    )
    .join('\n            ');
}

function organizationLd(baseUrl) {
  return {
    '@type': 'Organization',
    name: SITE_NAME,
    url: `${baseUrl}/`,
    logo: `${baseUrl}/favicon.svg`
  };
}

function homeStructuredData({ baseUrl, updatedAt, total }) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: `${baseUrl}/`,
      inLanguage: 'fr',
      description: 'Cours des actions de la Bourse Régionale des Valeurs Mobilières (BRVM).'
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: 'Cours des actions de la BRVM',
      description:
        `Cours de la veille, d’ouverture et de clôture, variation en pourcentage et volume échangé ` +
        `des ${total || ''} actions cotées à la Bourse Régionale des Valeurs Mobilières (BRVM), ` +
        'mis à jour automatiquement à partir du site officiel brvm.org.',
      url: `${baseUrl}/`,
      inLanguage: 'fr',
      isAccessibleForFree: true,
      keywords: ['BRVM', 'bourse', 'actions', 'UEMOA', 'Abidjan', 'cours de bourse', 'FCFA'],
      spatialCoverage: 'UEMOA (Afrique de l’Ouest)',
      ...(updatedAt ? { dateModified: new Date(updatedAt).toISOString() } : {}),
      isBasedOn: SOURCE_URL,
      creator: organizationLd(baseUrl),
      distribution: [
        {
          '@type': 'DataDownload',
          encodingFormat: 'application/json',
          contentUrl: `${baseUrl}/api/cours`
        },
        {
          '@type': 'DataDownload',
          encodingFormat: 'text/csv',
          contentUrl: `${baseUrl}/api/cours?format=csv`
        }
      ]
    }
  ];
}

function breadcrumbLd(baseUrl, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${baseUrl}${item.path}`
    }))
  };
}

module.exports = {
  SITE_NAME,
  SOURCE_URL,
  formatNumber,
  formatVolume,
  formatVariation,
  variationClass,
  formatDateTime,
  siteUrl,
  actionPath,
  jsonLd,
  headTags,
  marketSummary,
  marketMetrics,
  actionRows,
  homeStructuredData,
  breadcrumbLd
};
