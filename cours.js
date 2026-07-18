// api/cours.js — Fonction serverless Vercel (Node 18+)
// Récupère les cours officiels des actions BRVM depuis brvm.org
// et les expose en JSON ou CSV, avec cache pour ménager le site source.
//
// Endpoints une fois déployé :
//   GET /api/cours                    -> toutes les actions (JSON)
//   GET /api/cours?symbole=ONTBF      -> une seule action (JSON)
//   GET /api/cours?format=csv         -> toutes les actions (CSV, pour Google Sheets / Excel)

const cheerio = require('cheerio');

const SOURCE = 'https://www.brvm.org/fr/cours-actions/0';
const TTL_MS = 30 * 60 * 1000; // cache mémoire : 30 minutes

function toNumber(txt) {
  if (txt == null) return null;
  const n = parseFloat(
    String(txt)
      .replace(/[\s\u00a0\u202f]/g, '') // espaces normales et insécables
      .replace(',', '.')
  );
  return Number.isFinite(n) ? n : null;
}

async function scrape() {
  const resp = await fetch(SOURCE, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PortefeuilleBRVM/1.0; usage personnel)',
      'Accept-Language': 'fr',
    },
  });
  if (!resp.ok) throw new Error(`brvm.org a répondu HTTP ${resp.status}`);
  const html = await resp.text();
  const $ = cheerio.load(html);

  // La page contient plusieurs petits tableaux (Top 5, Flop 5, Activités du marché).
  // On sélectionne le tableau dont l'en-tête contient "Symbole" et qui a le plus de lignes.
  let best = null;
  $('table').each((_, t) => {
    const headers = $(t)
      .find('th')
      .map((_, th) => $(th).text().trim().toLowerCase())
      .get();
    if (headers.some((h) => h.startsWith('symbole'))) {
      const rows = $(t).find('tbody tr');
      if (!best || rows.length > best.rows.length) best = { rows };
    }
  });
  if (!best || best.rows.length === 0) {
    throw new Error('Tableau des cours introuvable : la structure du site a peut-être changé.');
  }

  const actions = [];
  best.rows.each((_, tr) => {
    const c = $(tr)
      .find('td')
      .map((_, td) => $(td).text().trim())
      .get();
    if (c.length >= 7 && c[0]) {
      actions.push({
        symbole: c[0],
        nom: c[1],
        volume: toNumber(c[2]),
        cours_veille: toNumber(c[3]),
        ouverture: toNumber(c[4]),
        cloture: toNumber(c[5]),
        variation_pct: toNumber(c[6]),
      });
    }
  });
  if (actions.length === 0) throw new Error('Aucune ligne de cotation lue.');

  const majMatch = $('body').text().match(/Dernière mise à jour\s*:\s*([^\n]+)/);
  return {
    source: SOURCE,
    maj: majMatch ? majMatch[1].trim() : null,
    actions,
  };
}

// Cache en mémoire du conteneur serverless (persiste entre invocations "chaudes")
let cache = { at: 0, data: null };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    if (!cache.data || Date.now() - cache.at > TTL_MS) {
      cache = { at: Date.now(), data: await scrape() };
    }
    // Cache CDN Vercel : les réponses sont servies depuis le CDN pendant 30 min,
    // puis une version périmée reste servie jusqu'à 24 h pendant la revalidation.
    // Résultat : brvm.org reçoit au plus ~1 requête toutes les 30 minutes,
    // quel que soit le nombre d'utilisateurs.
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');

    const { data } = cache;
    const symbole = String(req.query.symbole || '').trim().toUpperCase();
    const actions = symbole
      ? data.actions.filter((a) => a.symbole.toUpperCase() === symbole)
      : data.actions;

    if (symbole && actions.length === 0) {
      return res.status(404).json({
        erreur: `Symbole ${symbole} introuvable`,
        maj: data.maj,
        symboles_disponibles: data.actions.map((a) => a.symbole),
      });
    }

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      const head = 'symbole,nom,volume,cours_veille,ouverture,cloture,variation_pct';
      const lines = actions.map((a) =>
        [
          a.symbole,
          `"${a.nom.replace(/"/g, '""')}"`,
          a.volume,
          a.cours_veille,
          a.ouverture,
          a.cloture,
          a.variation_pct,
        ].join(',')
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.status(200).send([head, ...lines].join('\n'));
    }

    return res.status(200).json({ maj: data.maj, nombre: actions.length, actions });
  } catch (e) {
    return res.status(502).json({ erreur: e.message });
  }
};

// Export interne pour les tests
module.exports._scrapeHtml = function (html) {
  const $ = cheerio.load(html);
  let best = null;
  $('table').each((_, t) => {
    const headers = $(t)
      .find('th')
      .map((_, th) => $(th).text().trim().toLowerCase())
      .get();
    if (headers.some((h) => h.startsWith('symbole'))) {
      const rows = $(t).find('tbody tr');
      if (!best || rows.length > best.rows.length) best = { rows };
    }
  });
  if (!best) return [];
  const out = [];
  best.rows.each((_, tr) => {
    const c = $(tr)
      .find('td')
      .map((_, td) => $(td).text().trim())
      .get();
    if (c.length >= 7 && c[0]) {
      out.push({ symbole: c[0], cloture: toNumber(c[5]) });
    }
  });
  return out;
};
