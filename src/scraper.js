const cheerio = require('cheerio');
const { z } = require('zod');

const actionSchema = z.object({
  symbole: z.string().trim().min(1).max(20),
  nom: z.string().trim().max(200),
  volume: z.number().nullable(),
  cours_veille: z.number().nullable(),
  ouverture: z.number().nullable(),
  cloture: z.number().nullable(),
  variation_pct: z.number().nullable()
});

const payloadSchema = z.object({
  source: z.string(),
  maj: z.string().nullable(),
  scrapedAt: z.string(),
  actions: z.array(actionSchema).min(1)
});

const HEADER_FIELDS = {
  symbole: 'symbole',
  nom: 'nom',
  volume: 'volume',
  'cours veille': 'cours_veille',
  'cours de veille': 'cours_veille',
  ouverture: 'ouverture',
  cloture: 'cloture',
  'variation': 'variation_pct',
  'variation %': 'variation_pct',
  'variation pct': 'variation_pct'
};

const FALLBACK_INDEXES = {
  symbole: 0,
  nom: 1,
  volume: 2,
  cours_veille: 3,
  ouverture: 4,
  cloture: 5,
  variation_pct: 6
};

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(.*\)\s*$/, '')
    .trim();
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(value) {
  if (value == null) return null;
  const cleaned = String(value)
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/%/g, '')
    .replace(',', '.')
    .replace(/^\+/, '');
  if (!cleaned || cleaned === '-' || cleaned === '--') return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildHeaderIndexes(headers) {
  const indexes = {};
  headers.forEach((header, index) => {
    const field = HEADER_FIELDS[normalizeHeader(header)];
    if (field && indexes[field] === undefined) indexes[field] = index;
  });
  return indexes;
}

function findBestTable($) {
  let best = null;

  $('table').each((_, table) => {
    const headers = $(table)
      .find('th')
      .map((__, th) => normalizeText($(th).text()))
      .get();
    const indexes = buildHeaderIndexes(headers);
    if (indexes.symbole === undefined) return;

    const bodyRows = $(table).find('tbody tr');
    const rows = bodyRows.length > 0 ? bodyRows : $(table).find('tr').slice(1);
    if (!best || rows.length > best.rows.length) best = { rows, indexes };
  });

  return best;
}

function extractMaj($) {
  let best = null;

  $('body')
    .find('*')
    .each((_, element) => {
      const text = normalizeText($(element).text());
      if (text.length > 120 || !/Derni[eè]re mise [aà] jour/i.test(text)) return;
      if (!best || text.length < best.length) best = text;
    });

  if (!best) return null;
  const match = best.match(/Derni[eè]re mise [aà] jour\s*:\s*([^|]+)/i);
  return match ? normalizeText(match[1]) : null;
}

function parseHtml(html, source) {
  const $ = cheerio.load(html);
  const best = findBestTable($);

  if (!best || best.rows.length === 0) {
    throw new Error('Tableau des cours introuvable : la structure du site a peut-être changé.');
  }

  const indexes = { ...FALLBACK_INDEXES, ...best.indexes };
  const actions = [];

  best.rows.each((_, row) => {
    const cells = $(row)
      .find('td')
      .map((__, cell) => normalizeText($(cell).text()))
      .get();
    if (cells.length < 4) return;

    const valueAt = (field) => cells[indexes[field]];

    const symbole = valueAt('symbole');
    if (!symbole) return;

    const coursVeille = toNumber(valueAt('cours_veille'));
    const cloture = toNumber(valueAt('cloture'));
    let variation = toNumber(valueAt('variation_pct'));
    if (variation === null && coursVeille && cloture !== null) {
      variation = Number((((cloture - coursVeille) / coursVeille) * 100).toFixed(2));
    }

    actions.push({
      symbole,
      nom: valueAt('nom') || '',
      volume: toNumber(valueAt('volume')),
      cours_veille: coursVeille,
      ouverture: toNumber(valueAt('ouverture')),
      cloture,
      variation_pct: variation
    });
  });

  if (actions.length === 0) {
    throw new Error('Aucune ligne de cotation exploitable trouvée dans le tableau.');
  }

  return payloadSchema.parse({
    source,
    maj: extractMaj($),
    scrapedAt: new Date().toISOString(),
    actions
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url, { timeoutMs, userAgent }) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
    headers: {
      'User-Agent': userAgent,
      'Accept-Language': 'fr-FR,fr;q=0.9',
      Accept: 'text/html,application/xhtml+xml'
    }
  });

  if (!response.ok) {
    const error = new Error(`brvm.org a répondu HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.retryable = response.status >= 500 || response.status === 429;
    throw error;
  }

  return response.text();
}

function createScraper({ config, logger, fetchImpl = fetchHtml }) {
  async function scrape() {
    const userAgent =
      'Mozilla/5.0 (compatible; BRVM-Live/2.0; +https://github.com/Dayende-ib/brvm-live)';
    let lastError;

    for (let attempt = 0; attempt <= config.scrapeRetries; attempt += 1) {
      try {
        const html = await fetchImpl(config.sourceUrl, {
          timeoutMs: config.scrapeTimeoutMs,
          userAgent
        });
        return parseHtml(html, config.sourceUrl);
      } catch (error) {
        lastError = error;
        const canRetry = error.retryable !== false;
        if (!canRetry || attempt === config.scrapeRetries) break;

        const delay = 400 * 3 ** attempt;
        logger?.warn('Scraping BRVM : nouvelle tentative', {
          attempt: attempt + 1,
          delayMs: delay,
          error: error.message
        });
        await sleep(delay);
      }
    }

    const wrapped = new Error(`Impossible de récupérer les cours BRVM : ${lastError.message}`);
    wrapped.code = 'SCRAPE_FAILED';
    wrapped.cause = lastError;
    throw wrapped;
  }

  return { scrape };
}

module.exports = { createScraper, parseHtml, toNumber };
