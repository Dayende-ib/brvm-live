const { escapeHtml } = require('./utils/html');

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12
};

const shortDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
});

function pad(value) {
  return String(value).padStart(2, '0');
}

function isoDay(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Jour de la séance (AAAA-MM-JJ) à partir de la mention « Dernière mise à jour » de brvm.org,
// par exemple « Vendredi, 6 novembre, 2026 - 22:45 » ou « 08/11/2026 18:30 ».
function parseMajDay(maj) {
  if (typeof maj !== 'string') return null;
  const text = maj
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (numeric) return isoDay(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));

  const written = text.match(/\b(\d{1,2})(?:er)?\s+([a-z]+)\W+(\d{4})\b/);
  if (written && MONTHS[written[2]]) {
    return isoDay(Number(written[3]), MONTHS[written[2]], Number(written[1]));
  }
  return null;
}

// Abidjan est en UTC+0 toute l'année : la date UTC est la date locale de la séance.
function sessionDay(data, now = Date.now()) {
  return parseMajDay(data?.maj) ?? new Date(data?.scrapedAt || now).toISOString().slice(0, 10);
}

function shiftDay(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function formatDay(day) {
  return shortDateFormatter.format(new Date(`${day}T00:00:00Z`));
}

function change(from, to) {
  if (typeof from !== 'number' || typeof to !== 'number' || from === 0) return null;
  return Number((((to - from) / from) * 100).toFixed(2));
}

const PERIODS = [
  { label: '1 semaine', days: 7 },
  { label: '1 mois', days: 30 },
  { label: '3 mois', days: 91 },
  { label: '1 an', days: 365 }
];

// Performance de la clôture sur plusieurs périodes, à partir d'un historique trié par jour croissant.
function performance(history) {
  const points = history.filter((row) => typeof row.cloture === 'number');
  if (points.length < 2) return { periods: [], since: null };

  const last = points[points.length - 1];
  const periods = PERIODS.map((period) => {
    const target = shiftDay(last.day, -period.days);
    // Dernière clôture connue au plus tard à la date cible ; aucune si l'historique est trop court.
    let base = null;
    for (const row of points) {
      if (row.day <= target) base = row;
      else break;
    }
    return { ...period, variation: base ? change(base.cloture, last.cloture) : null, from: base?.day ?? null };
  });

  const first = points[0];
  const closes = points.map((row) => row.cloture);
  return {
    periods,
    since: {
      day: first.day,
      variation: change(first.cloture, last.cloture),
      high: Math.max(...closes),
      low: Math.min(...closes),
      sessions: points.length
    }
  };
}

// Graphique SVG de la clôture rendu côté serveur (aucun JavaScript, compatible CSP).
function priceChart(history, { symbole, width = 720, height = 240 } = {}) {
  const points = history.filter((row) => typeof row.cloture === 'number');
  if (points.length < 2) return '';

  const pad = { top: 16, right: 12, bottom: 28, left: 64 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;

  const closes = points.map((row) => row.cloture);
  let min = Math.min(...closes);
  let max = Math.max(...closes);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const margin = (max - min) * 0.08;
  min -= margin;
  max += margin;

  const x = (index) => pad.left + (index / (points.length - 1)) * innerWidth;
  const y = (value) => pad.top + (1 - (value - min) / (max - min)) * innerHeight;
  const fmt = (value) => value.toFixed(1);

  const line = points.map((row, index) => `${index === 0 ? 'M' : 'L'}${fmt(x(index))} ${fmt(y(row.cloture))}`).join(' ');
  const area = `${line} L${fmt(x(points.length - 1))} ${fmt(pad.top + innerHeight)} L${fmt(x(0))} ${fmt(pad.top + innerHeight)} Z`;
  const trend = closes[closes.length - 1] >= closes[0] ? 'up' : 'down';
  const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

  const ticks = [max - margin, (max + min) / 2, min + margin].map((value) => {
    const ty = fmt(y(value));
    return `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${ty}" y2="${ty}"></line>
      <text class="chart-label" x="${pad.left - 8}" y="${ty}" text-anchor="end" dominant-baseline="middle">${number.format(value)}</text>`;
  });

  const first = points[0];
  const last = points[points.length - 1];
  const title = `Évolution du cours de clôture de ${symbole}`;
  const desc = `Du ${formatDay(first.day)} (${number.format(first.cloture)} FCFA) au ${formatDay(last.day)} (${number.format(last.cloture)} FCFA), ${points.length} séances.`;

  return `<svg class="price-chart chart-${trend}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-desc">
      <title id="chart-title">${escapeHtml(title)}</title>
      <desc id="chart-desc">${escapeHtml(desc)}</desc>
      ${ticks.join('\n      ')}
      <path class="chart-area" d="${area}"></path>
      <path class="chart-line" d="${line}"></path>
      <circle class="chart-dot" cx="${fmt(x(points.length - 1))}" cy="${fmt(y(last.cloture))}" r="3.5"></circle>
      <text class="chart-label" x="${pad.left}" y="${height - 8}" text-anchor="start">${escapeHtml(formatDay(first.day))}</text>
      <text class="chart-label" x="${width - pad.right}" y="${height - 8}" text-anchor="end">${escapeHtml(formatDay(last.day))}</text>
    </svg>`;
}

module.exports = { parseMajDay, sessionDay, shiftDay, formatDay, performance, priceChart };
