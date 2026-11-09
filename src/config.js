const path = require('node:path');
const crypto = require('node:crypto');
const { z } = require('zod');
const { hashPassword } = require('./security');

const boolFromEnv = (defaultValue) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
    .optional()
    .transform((value) => {
      if (value === undefined) return defaultValue;
      return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATA_DIR: z.string().min(1).default('./data'),
  PUBLIC_URL: z.string().url().optional(),

  SOURCE_URL: z.string().url().default('https://www.brvm.org/fr/cours-actions/0'),
  CACHE_TTL_MS: z.coerce.number().int().min(0).default(30 * 60 * 1000),
  CACHE_MAX_STALE_MS: z.coerce.number().int().min(0).default(24 * 60 * 60 * 1000),
  SCRAPE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(10000),
  SCRAPE_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  SCRAPE_FAILURE_COOLDOWN_MS: z.coerce.number().int().min(0).default(60 * 1000),

  ALLOWED_ORIGINS: z.string().default(''),
  TRUST_PROXY: z.string().default('1'),

  SESSION_SECRET: z.string().min(32).optional(),
  SESSION_TTL_MS: z.coerce.number().int().min(60000).default(8 * 60 * 60 * 1000),
  USER_SESSION_TTL_MS: z.coerce.number().int().min(60000).default(7 * 24 * 60 * 60 * 1000),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(1).optional(),
  ADMIN_PASSWORD_HASH: z.string().min(1).optional(),

  API_KEYS: z.string().default(''),
  API_KEYS_REQUIRED: boolFromEnv(false),

  VISITS_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  RATE_LIMIT_API: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_API_KEY: z.coerce.number().int().min(1).default(600),
  RATE_LIMIT_VISITS: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_LOGIN: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_ADMIN: z.coerce.number().int().min(1).default(240),
  RATE_LIMIT_SIGNUP: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_USER_LOGIN: z.coerce.number().int().min(1).default(15),
  RATE_LIMIT_ACCOUNT: z.coerce.number().int().min(1).default(120)
});

const ADMIN_HASH_PATTERN = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/;

function parseTrustProxy(value) {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function splitList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadConfig(env = process.env) {
  // Une variable laissée vide dans .env (ex. `ADMIN_PASSWORD_HASH=`) équivaut à une variable absente.
  const defined = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && String(value).trim() !== '')
  );
  const parsed = envSchema.safeParse(defined);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuration invalide -> ${details}`);
  }

  const cfg = parsed.data;
  const warnings = [];
  const isProduction = cfg.NODE_ENV === 'production';

  let sessionSecret = cfg.SESSION_SECRET;
  if (!sessionSecret) {
    if (isProduction) {
      throw new Error(
        'SESSION_SECRET est requis en production (32 caractères minimum). ' +
          'Générez-le avec : openssl rand -hex 32'
      );
    }
    sessionSecret = crypto.randomBytes(32).toString('hex');
    warnings.push(
      'SESSION_SECRET absent : un secret éphémère a été généré. ' +
        'Les sessions admin/utilisateurs et les compteurs de visiteurs seront réinitialisés à chaque redémarrage.'
    );
  }

  const apiKeys = splitList(cfg.API_KEYS);
  for (const key of apiKeys) {
    if (key.length < 16) {
      warnings.push('Une clé API de moins de 16 caractères est configurée : utilisez des clés plus longues.');
    }
  }

  const adminPasswordHash = cfg.ADMIN_PASSWORD_HASH || (cfg.ADMIN_PASSWORD ? hashPassword(cfg.ADMIN_PASSWORD) : null);
  const adminEnabled = Boolean(adminPasswordHash);
  if (cfg.ADMIN_PASSWORD && cfg.ADMIN_PASSWORD_HASH) {
    warnings.push('ADMIN_PASSWORD et ADMIN_PASSWORD_HASH sont tous deux définis : ADMIN_PASSWORD_HASH est prioritaire.');
  }
  if (cfg.ADMIN_PASSWORD_HASH && !ADMIN_HASH_PATTERN.test(cfg.ADMIN_PASSWORD_HASH)) {
    warnings.push(
      "ADMIN_PASSWORD_HASH n'a pas le format attendu (scrypt$N$r$p$sel$hash) : la connexion admin échouera. " +
        "Dans .env, entourez la valeur d'apostrophes pour que Docker Compose n'interprète pas les $ : " +
        "ADMIN_PASSWORD_HASH='scrypt$...'"
    );
  }
  if (isProduction && cfg.ADMIN_PASSWORD && !cfg.ADMIN_PASSWORD_HASH) {
    warnings.push('ADMIN_PASSWORD (en clair) est utilisé en production : préférez ADMIN_PASSWORD_HASH.');
  }
  if (!adminEnabled) {
    warnings.push("Aucun mot de passe admin configuré : l'interface /admin est désactivée.");
  }

  const publicUrl = cfg.PUBLIC_URL ? cfg.PUBLIC_URL.replace(/\/+$/, '') : null;
  if (isProduction && !publicUrl) {
    warnings.push(
      'PUBLIC_URL absent : les URL canoniques, le sitemap et les balises de partage utiliseront ' +
        "l'hôte de la requête. Définissez PUBLIC_URL=https://votre-domaine pour le référencement."
    );
  }

  const allowedOrigins = splitList(cfg.ALLOWED_ORIGINS);
  if (allowedOrigins.includes('*')) {
    warnings.push('ALLOWED_ORIGINS contient "*" : toutes les origines peuvent appeler l’API.');
  }

  return {
    nodeEnv: cfg.NODE_ENV,
    isProduction,
    port: cfg.PORT,
    host: cfg.HOST,
    dataDir: path.resolve(cfg.DATA_DIR),
    publicUrl,

    sourceUrl: cfg.SOURCE_URL,
    cacheTtlMs: cfg.CACHE_TTL_MS,
    cacheMaxStaleMs: cfg.CACHE_MAX_STALE_MS,
    scrapeTimeoutMs: cfg.SCRAPE_TIMEOUT_MS,
    scrapeRetries: cfg.SCRAPE_RETRIES,
    scrapeFailureCooldownMs: cfg.SCRAPE_FAILURE_COOLDOWN_MS,

    allowedOrigins,
    trustProxy: parseTrustProxy(cfg.TRUST_PROXY),

    sessionSecret,
    sessionTtlMs: cfg.SESSION_TTL_MS,
    userSessionTtlMs: cfg.USER_SESSION_TTL_MS,
    admin: {
      enabled: adminEnabled,
      username: cfg.ADMIN_USERNAME,
      passwordHash: adminPasswordHash
    },

    apiKeys,
    apiKeysRequired: cfg.API_KEYS_REQUIRED,

    visitsRetentionDays: cfg.VISITS_RETENTION_DAYS,

    rateLimits: {
      windowMs: cfg.RATE_LIMIT_WINDOW_MS,
      api: cfg.RATE_LIMIT_API,
      apiKey: cfg.RATE_LIMIT_API_KEY,
      visits: cfg.RATE_LIMIT_VISITS,
      login: cfg.RATE_LIMIT_LOGIN,
      admin: cfg.RATE_LIMIT_ADMIN,
      signup: cfg.RATE_LIMIT_SIGNUP,
      userLogin: cfg.RATE_LIMIT_USER_LOGIN,
      account: cfg.RATE_LIMIT_ACCOUNT
    },

    warnings
  };
}

module.exports = { loadConfig };
