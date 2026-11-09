const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
  `
  CREATE TABLE cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    path TEXT NOT NULL,
    visitor_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_visits_day ON visits(day);
  CREATE INDEX idx_visits_day_hash ON visits(day, visitor_hash);
  `,
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  );
  CREATE TABLE favorites (
    user_id INTEGER NOT NULL,
    symbole TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, symbole),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_favorites_user ON favorites(user_id);
  `,
  `
  ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
  `,
  `
  CREATE TABLE quotes (
    symbole TEXT NOT NULL,
    day TEXT NOT NULL,
    nom TEXT NOT NULL,
    volume REAL,
    cours_veille REAL,
    ouverture REAL,
    cloture REAL,
    variation_pct REAL,
    recorded_at INTEGER NOT NULL,
    PRIMARY KEY (symbole, day)
  );
  CREATE INDEX idx_quotes_day ON quotes(day);
  `,
  `
  ALTER TABLE visits ADD COLUMN source TEXT;
  ALTER TABLE visits ADD COLUMN source_type TEXT;
  ALTER TABLE visits ADD COLUMN referrer_host TEXT;
  ALTER TABLE visits ADD COLUMN utm_medium TEXT;
  ALTER TABLE visits ADD COLUMN utm_campaign TEXT;
  ALTER TABLE visits ADD COLUMN country TEXT;
  ALTER TABLE visits ADD COLUMN device TEXT;
  ALTER TABLE visits ADD COLUMN browser TEXT;
  ALTER TABLE visits ADD COLUMN os TEXT;
  `
];

// Dimensions d'audience consultables dans l'administration. Liste fermée : ces noms de colonnes
// sont insérés dans le SQL, ils ne doivent jamais venir de la requête HTTP.
const AUDIENCE_DIMENSIONS = {
  sources: { column: 'source', external: true },
  types: { column: 'source_type', external: true },
  referents: { column: 'referrer_host', external: true },
  campagnes: { column: 'utm_campaign', external: true },
  pays: { column: 'country', external: false },
  appareils: { column: 'device', external: false },
  navigateurs: { column: 'browser', external: false },
  systemes: { column: 'os', external: false },
  pages: { column: 'path', external: false }
};

function migrate(db) {
  const current = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function openDatabase(dataDir, logger) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'brvm-live.sqlite');
  const db = new DatabaseSync(file);

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);

  const statements = {
    getCache: db.prepare('SELECT value, updated_at FROM cache WHERE key = ?'),
    setCache: db.prepare(`
      INSERT INTO cache (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `),
    insertVisit: db.prepare(`
      INSERT INTO visits (
        day, path, visitor_hash, created_at,
        source, source_type, referrer_host, utm_medium, utm_campaign,
        country, device, browser, os
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    totalVisits: db.prepare(`
      SELECT COUNT(*) AS vues,
             COUNT(DISTINCT day || ':' || visitor_hash) AS uniques
      FROM visits
    `),
    dayVisits: db.prepare(`
      SELECT COUNT(*) AS vues,
             COUNT(DISTINCT visitor_hash) AS uniques
      FROM visits
      WHERE day = ?
    `),
    visitSeries: db.prepare(`
      SELECT day,
             COUNT(*) AS vues,
             COUNT(DISTINCT visitor_hash) AS uniques
      FROM visits
      WHERE day >= ?
      GROUP BY day
      ORDER BY day ASC
    `),
    deleteVisitsBefore: db.prepare('DELETE FROM visits WHERE day < ?'),
    insertUser: db.prepare(
      'INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
    ),
    findUserByLogin: db.prepare(
      'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1'
    ),
    findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ? LIMIT 1'),
    findUserByEmail: db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1'),
    findUserById: db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1'),
    touchLastLogin: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
    listFavorites: db.prepare(
      'SELECT symbole, created_at FROM favorites WHERE user_id = ? ORDER BY created_at ASC'
    ),
    addFavorite: db.prepare(
      'INSERT OR IGNORE INTO favorites (user_id, symbole, created_at) VALUES (?, ?, ?)'
    ),
    removeFavorite: db.prepare('DELETE FROM favorites WHERE user_id = ? AND symbole = ?'),
    updatePassword: db.prepare(
      'UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?'
    ),
    bumpSessionVersion: db.prepare(
      'UPDATE users SET session_version = session_version + 1 WHERE id = ?'
    ),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    upsertQuote: db.prepare(`
      INSERT INTO quotes (symbole, day, nom, volume, cours_veille, ouverture, cloture, variation_pct, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbole, day) DO UPDATE SET
        nom = excluded.nom,
        volume = excluded.volume,
        cours_veille = excluded.cours_veille,
        ouverture = excluded.ouverture,
        cloture = excluded.cloture,
        variation_pct = excluded.variation_pct,
        recorded_at = excluded.recorded_at
    `),
    quoteHistory: db.prepare(`
      SELECT day, volume, cours_veille, ouverture, cloture, variation_pct
      FROM quotes
      WHERE symbole = ? AND day >= ?
      ORDER BY day ASC
    `),
    historyStats: db.prepare(`
      SELECT MIN(day) AS first_day, MAX(day) AS last_day, COUNT(DISTINCT day) AS sessions
      FROM quotes
    `),
    countUsers: db.prepare('SELECT COUNT(*) AS total FROM users'),
    ping: db.prepare('SELECT 1 AS ok')
  };

  function getCache(key) {
    const row = statements.getCache.get(key);
    if (!row) return null;
    try {
      return { value: JSON.parse(row.value), updatedAt: Number(row.updated_at) };
    } catch (error) {
      logger?.warn('Entrée de cache illisible ignorée', { key, error: error.message });
      return null;
    }
  }

  function setCache(key, value, updatedAt = Date.now()) {
    statements.setCache.run(key, JSON.stringify(value), updatedAt);
  }

  function recordVisit({
    day,
    path: visitPath,
    visitorHash,
    createdAt = Date.now(),
    source = null,
    sourceType = null,
    referrerHost = null,
    utmMedium = null,
    utmCampaign = null,
    country = null,
    device = null,
    browser = null,
    os = null
  }) {
    statements.insertVisit.run(
      day,
      visitPath,
      visitorHash,
      createdAt,
      source,
      sourceType,
      referrerHost,
      utmMedium,
      utmCampaign,
      country,
      device,
      browser,
      os
    );
  }

  // Une requête préparée par dimension : visiteurs uniques (par jour) et pages vues.
  // Pour les dimensions d'origine, la navigation interne au site est exclue.
  const audienceStatements = Object.fromEntries(
    Object.entries(AUDIENCE_DIMENSIONS).map(([name, { column, external }]) => [
      name,
      db.prepare(`
        SELECT ${column} AS valeur,
               COUNT(DISTINCT day || ':' || visitor_hash) AS visiteurs,
               COUNT(*) AS vues
        FROM visits
        WHERE day >= ?${external ? " AND (source_type IS NULL OR source_type != 'internal')" : ''}
        GROUP BY ${column}
        ORDER BY visiteurs DESC, vues DESC
        LIMIT ?
      `)
    ])
  );

  const audienceTotals = db.prepare(`
    SELECT COUNT(DISTINCT day || ':' || visitor_hash) AS visiteurs, COUNT(*) AS vues
    FROM visits
    WHERE day >= ?
  `);

  function getAudienceBreakdown(sinceDay, limit = 10) {
    const totals = audienceTotals.get(sinceDay);
    const breakdown = {
      visiteurs: Number(totals.visiteurs || 0),
      vues: Number(totals.vues || 0)
    };
    for (const [name, statement] of Object.entries(audienceStatements)) {
      breakdown[name] = statement.all(sinceDay, limit).map((row) => ({
        valeur: row.valeur ?? null,
        visiteurs: Number(row.visiteurs || 0),
        vues: Number(row.vues || 0)
      }));
    }
    return breakdown;
  }

  function getVisitSummary(day) {
    const total = statements.totalVisits.get();
    const today = statements.dayVisits.get(day);
    return {
      vuesTotal: Number(total.vues || 0),
      uniquesTotal: Number(total.uniques || 0),
      aujourdhui: {
        jour: day,
        vues: Number(today.vues || 0),
        uniques: Number(today.uniques || 0)
      }
    };
  }

  function getVisitSeries(sinceDay) {
    return statements.visitSeries.all(sinceDay).map((row) => ({
      jour: row.day,
      vues: Number(row.vues || 0),
      uniques: Number(row.uniques || 0)
    }));
  }

  function deleteVisitsBefore(day) {
    const result = statements.deleteVisitsBefore.run(day);
    return Number(result.changes || 0);
  }

  function createUser({ username, email, passwordHash, createdAt = Date.now() }) {
    const result = statements.insertUser.run(username, email, passwordHash, createdAt);
    return Number(result.lastInsertRowid);
  }

  function findUserByLogin(login) {
    return statements.findUserByLogin.get(login, login) || null;
  }

  function findUserByUsername(username) {
    return statements.findUserByUsername.get(username) || null;
  }

  function findUserByEmail(email) {
    return statements.findUserByEmail.get(email) || null;
  }

  function findUserById(id) {
    return statements.findUserById.get(id) || null;
  }

  function touchLastLogin(id, at = Date.now()) {
    statements.touchLastLogin.run(at, id);
  }

  function listFavorites(userId) {
    return statements.listFavorites.all(userId).map((row) => ({
      symbole: row.symbole,
      createdAt: Number(row.created_at)
    }));
  }

  function addFavorite(userId, symbole, createdAt = Date.now()) {
    statements.addFavorite.run(userId, symbole, createdAt);
  }

  function removeFavorite(userId, symbole) {
    const result = statements.removeFavorite.run(userId, symbole);
    return Number(result.changes || 0) > 0;
  }

  // Change le mot de passe et invalide toutes les sessions existantes du compte.
  function updatePassword(id, passwordHash) {
    statements.updatePassword.run(passwordHash, id);
  }

  function bumpSessionVersion(id) {
    statements.bumpSessionVersion.run(id);
  }

  // Les favoris sont supprimés en cascade (FOREIGN KEY ... ON DELETE CASCADE).
  function deleteUser(id) {
    const result = statements.deleteUser.run(id);
    return Number(result.changes || 0) > 0;
  }

  // Enregistre (ou met à jour) les cours d'une séance ; une ligne par action et par jour.
  function recordQuotes(day, actions, recordedAt = Date.now()) {
    db.exec('BEGIN');
    try {
      for (const action of actions) {
        statements.upsertQuote.run(
          action.symbole,
          day,
          action.nom ?? '',
          action.volume ?? null,
          action.cours_veille ?? null,
          action.ouverture ?? null,
          action.cloture ?? null,
          action.variation_pct ?? null,
          recordedAt
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return actions.length;
  }

  function getQuoteHistory(symbole, sinceDay = '0000-00-00') {
    return statements.quoteHistory.all(symbole, sinceDay).map((row) => ({
      day: row.day,
      volume: row.volume,
      cours_veille: row.cours_veille,
      ouverture: row.ouverture,
      cloture: row.cloture,
      variation_pct: row.variation_pct
    }));
  }

  function getHistoryStats() {
    const row = statements.historyStats.get();
    return {
      firstDay: row.first_day ?? null,
      lastDay: row.last_day ?? null,
      sessions: Number(row.sessions || 0)
    };
  }

  function countUsers() {
    return Number(statements.countUsers.get().total || 0);
  }

  function ping() {
    return statements.ping.get().ok === 1;
  }

  function close() {
    db.close();
  }

  return {
    file,
    getCache,
    setCache,
    recordVisit,
    getAudienceBreakdown,
    getVisitSummary,
    getVisitSeries,
    deleteVisitsBefore,
    createUser,
    findUserByLogin,
    findUserByUsername,
    findUserByEmail,
    findUserById,
    touchLastLogin,
    listFavorites,
    addFavorite,
    removeFavorite,
    updatePassword,
    bumpSessionVersion,
    deleteUser,
    recordQuotes,
    getQuoteHistory,
    getHistoryStats,
    countUsers,
    ping,
    close
  };
}

module.exports = { openDatabase };
