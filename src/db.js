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
  `
];

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
    insertVisit: db.prepare(
      'INSERT INTO visits (day, path, visitor_hash, created_at) VALUES (?, ?, ?, ?)'
    ),
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

  function recordVisit({ day, path: visitPath, visitorHash, createdAt = Date.now() }) {
    statements.insertVisit.run(day, visitPath, visitorHash, createdAt);
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
    countUsers,
    ping,
    close
  };
}

module.exports = { openDatabase };
