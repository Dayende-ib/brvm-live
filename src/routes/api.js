const express = require('express');
const { z } = require('zod');
const { todayUtc } = require('../middleware/visits');

const querySchema = z.object({
  symbole: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((value) => (value ? value.toUpperCase() : undefined)),
  format: z.enum(['json', 'csv']).default('json')
});

const historySchema = z.object({
  symbole: z
    .string({ error: 'Le paramètre symbole est requis.' })
    .trim()
    .min(1, 'Le paramètre symbole est requis.')
    .max(20)
    .transform((value) => value.toUpperCase()),
  jours: z.coerce.number().int().min(1).max(3650).optional(),
  format: z.enum(['json', 'csv']).default('json')
});

function historyCsv(rows) {
  const header = 'jour,cours_veille,ouverture,cloture,variation_pct,volume';
  const lines = rows.map((row) =>
    [row.day, row.cours_veille, row.ouverture, row.cloture, row.variation_pct, row.volume]
      .map((value) => csvCell(value))
      .join(',')
  );
  return `\uFEFF${[header, ...lines].join('\r\n')}`;
}

function csvCell(value, { protectFormula = false } = {}) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (protectFormula && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(actions) {
  const header = 'symbole,nom,volume,cours_veille,ouverture,cloture,variation_pct';
  const lines = actions.map((action) =>
    [
      csvCell(action.symbole, { protectFormula: true }),
      csvCell(action.nom, { protectFormula: true }),
      csvCell(action.volume),
      csvCell(action.cours_veille),
      csvCell(action.ouverture),
      csvCell(action.cloture),
      csvCell(action.variation_pct)
    ].join(',')
  );
  return `\uFEFF${[header, ...lines].join('\r\n')}`;
}

function createApiRouter({ config, cache, db, logger }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({
      message: 'BRVM Live API',
      version: '2.0.0',
      documentation: '/api.html',
      endpoints: {
        '/api/cours': 'Toutes les actions (JSON)',
        '/api/cours?symbole=ONTBF': 'Une action par son symbole',
        '/api/cours?format=csv': 'Toutes les actions (CSV)',
        '/api/historique?symbole=ONTBF': 'Historique des séances d’une action (JSON)',
        '/api/historique?symbole=ONTBF&jours=30&format=csv': 'Historique sur 30 jours (CSV)',
        '/api/visites': 'Statistiques de fréquentation agrégées'
      },
      cache: {
        ttl_secondes: Math.round(config.cacheTtlMs / 1000),
        stale_max_secondes: Math.round(config.cacheMaxStaleMs / 1000)
      },
      authentification: config.apiKeys.length
        ? {
            type: 'clé API',
            requise: config.apiKeysRequired,
            en_tetes: ['X-API-Key', 'Authorization: Bearer <clé>']
          }
        : { type: 'publique' }
    });
  });

  router.get('/cours', async (req, res, next) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        erreur: 'Paramètres invalides',
        details: parsed.error.issues.map((issue) => ({
          champ: issue.path.join('.') || 'query',
          message: issue.message
        }))
      });
    }

    const { symbole, format } = parsed.data;

    try {
      const result = await cache.get();
      const { data } = result;
      const actions = symbole
        ? data.actions.filter((action) => action.symbole.toUpperCase() === symbole)
        : data.actions;

      if (symbole && actions.length === 0) {
        return res.status(404).json({
          erreur: `Symbole ${symbole} introuvable`,
          maj: data.maj,
          symboles_disponibles: data.actions.map((action) => action.symbole)
        });
      }

      res.setHeader('X-Data-Source', result.source);
      res.setHeader('X-Data-Updated-At', new Date(result.updatedAt).toISOString());
      if (result.stale) {
        res.setHeader('Warning', '110 - "Response is stale"');
        res.setHeader('Cache-Control', 'no-store');
      } else {
        res.setHeader(
          'Cache-Control',
          `public, max-age=60, s-maxage=${Math.max(1, Math.round(config.cacheTtlMs / 1000))}, stale-while-revalidate=86400`
        );
      }

      if (format === 'csv') {
        const day = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="cours-brvm-${day}.csv"`);
        return res.status(200).send(toCsv(actions));
      }

      return res.status(200).json({
        maj: data.maj,
        nombre: actions.length,
        actions,
        source: data.source,
        recupere_le: data.scrapedAt,
        mis_a_jour_le: new Date(result.updatedAt).toISOString(),
        perime: result.stale
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/historique', (req, res) => {
    const parsed = historySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        erreur: 'Paramètres invalides',
        details: parsed.error.issues.map((issue) => ({
          champ: issue.path.join('.') || 'query',
          message: issue.message
        }))
      });
    }

    const { symbole, jours, format } = parsed.data;
    const since = jours
      ? new Date(Date.now() - jours * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : undefined;
    const rows = db.getQuoteHistory(symbole, since);

    if (rows.length === 0) {
      return res.status(404).json({ erreur: `Aucun historique pour le symbole ${symbole}.` });
    }

    res.setHeader('Cache-Control', 'public, max-age=300');
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="historique-${symbole}.csv"`);
      return res.status(200).send(historyCsv(rows));
    }

    return res.json({
      symbole,
      nombre: rows.length,
      premiere_seance: rows[0].day,
      derniere_seance: rows[rows.length - 1].day,
      seances: rows.map((row) => ({
        jour: row.day,
        cours_veille: row.cours_veille,
        ouverture: row.ouverture,
        cloture: row.cloture,
        variation_pct: row.variation_pct,
        volume: row.volume
      }))
    });
  });

  router.get('/visites', (req, res) => {
    const day = todayUtc();
    const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const summary = db.getVisitSummary(day);
    const series = db.getVisitSeries(since);

    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({
      vues_total: summary.vuesTotal,
      visiteurs_uniques: summary.uniquesTotal,
      aujourd_hui: summary.aujourdhui,
      serie_30_jours: series
    });
  });

  router.use((req, res) => {
    res.status(404).json({
      erreur: 'Endpoint non trouvé',
      endpoints: ['/api/cours', '/api/historique', '/api/visites']
    });
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error.code === 'SCRAPE_FAILED') {
      logger?.error('Source BRVM indisponible', { error: error.message, cause: error.cause?.message });
      return res.status(502).json({
        erreur: 'La source BRVM est momentanément indisponible et aucune donnée récente n’est en cache.',
        reessayez_dans_secondes: 60
      });
    }

    return next(error);
  });

  return router;
}

module.exports = { createApiRouter, toCsv };
