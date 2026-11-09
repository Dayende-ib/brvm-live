const fs = require('node:fs');
const { Reader } = require('maxmind');
const Bowser = require('bowser');

// Base « IP to Country Lite » de DB-IP (CC BY 4.0) : attribution obligatoire vers https://db-ip.com
// sur les pages qui affichent ces résultats (admin, page de confidentialité).
const GEO_DB_PATH = require.resolve('@ip-location-db/dbip-country-mmdb/dbip-country.mmdb');

let geoReader;
let geoFailed = false;

// Chargée une seule fois par processus (~16 Mo en mémoire), à la première visite.
function geoLookup(logger) {
  if (geoReader || geoFailed) return geoReader ?? null;
  try {
    geoReader = new Reader(fs.readFileSync(GEO_DB_PATH));
  } catch (error) {
    geoFailed = true;
    logger?.warn('Base de géolocalisation indisponible : pays non renseignés', { error: error.message });
  }
  return geoReader ?? null;
}

// Pays (code ISO à 2 lettres) déduit de l'IP. L'IP elle-même n'est jamais stockée.
function countryOf(ip, logger) {
  if (!ip) return null;
  const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  try {
    const result = geoLookup(logger)?.get(address);
    const code = result?.country_code;
    return typeof code === 'string' && /^[A-Z]{2}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

const KNOWN_SOURCES = [
  // L'ordre compte : gemini.google.com avant google.
  { pattern: /(^|\.)gemini\.google\.com$/, name: 'Gemini', type: 'ai' },
  { pattern: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/, name: 'ChatGPT', type: 'ai' },
  { pattern: /(^|\.)perplexity\.ai$/, name: 'Perplexity', type: 'ai' },
  { pattern: /(^|\.)claude\.ai$/, name: 'Claude', type: 'ai' },
  { pattern: /(^|\.)copilot\.microsoft\.com$/, name: 'Copilot', type: 'ai' },
  { pattern: /(^|\.)google\.[a-z.]+$/, name: 'Google', type: 'search' },
  { pattern: /(^|\.)bing\.com$/, name: 'Bing', type: 'search' },
  { pattern: /(^|\.)duckduckgo\.com$/, name: 'DuckDuckGo', type: 'search' },
  { pattern: /(^|\.)yahoo\.[a-z.]+$/, name: 'Yahoo', type: 'search' },
  { pattern: /(^|\.)(ecosia\.org|qwant\.com|yandex\.[a-z.]+|baidu\.com|brave\.com)$/, name: null, type: 'search' },
  { pattern: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/, name: 'Facebook', type: 'social' },
  { pattern: /(^|\.)instagram\.com$/, name: 'Instagram', type: 'social' },
  { pattern: /(^|\.)(t\.co|twitter\.com|x\.com)$/, name: 'X (Twitter)', type: 'social' },
  { pattern: /(^|\.)(linkedin\.com|lnkd\.in)$/, name: 'LinkedIn', type: 'social' },
  { pattern: /(^|\.)(whatsapp\.com|wa\.me)$/, name: 'WhatsApp', type: 'social' },
  { pattern: /(^|\.)(t\.me|telegram\.org|telegram\.me)$/, name: 'Telegram', type: 'social' },
  { pattern: /(^|\.)(youtube\.com|youtu\.be)$/, name: 'YouTube', type: 'social' },
  { pattern: /(^|\.)tiktok\.com$/, name: 'TikTok', type: 'social' },
  { pattern: /(^|\.)reddit\.com$/, name: 'Reddit', type: 'social' },
  { pattern: /(^|\.)github\.com$/, name: 'GitHub', type: 'referral' }
];

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Paramètre UTM nettoyé : uniquement des caractères simples, pour ne jamais stocker de texte libre.
function cleanTag(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return cleaned || null;
}

// Origine de la visite : campagne (UTM), site référent (nom de domaine seulement) ou accès direct.
function sourceOf({ referer, query = {}, ownHosts = [] }) {
  const utmSource = cleanTag(query.utm_source);
  const campaign = {
    utmMedium: cleanTag(query.utm_medium),
    utmCampaign: cleanTag(query.utm_campaign)
  };
  const referrerHost = referer ? hostOf(referer) : null;
  const own = ownHosts.filter(Boolean).map((host) => host.toLowerCase().replace(/^www\./, ''));

  if (utmSource) return { source: utmSource, sourceType: 'campaign', referrerHost, ...campaign };
  if (!referrerHost) return { source: 'direct', sourceType: 'direct', referrerHost: null, ...campaign };
  if (own.includes(referrerHost)) return { source: 'interne', sourceType: 'internal', referrerHost: null, ...campaign };

  const known = KNOWN_SOURCES.find((entry) => entry.pattern.test(referrerHost));
  if (known) return { source: known.name ?? referrerHost, sourceType: known.type, referrerHost, ...campaign };
  return { source: referrerHost, sourceType: 'referral', referrerHost, ...campaign };
}

function short(value, max = 40) {
  return typeof value === 'string' && value ? value.slice(0, max) : null;
}

// Type d'appareil, navigateur et système (familles uniquement, sans version ni User-Agent brut).
function deviceOf(userAgent) {
  if (!userAgent) return { device: null, browser: null, os: null };
  try {
    const parsed = Bowser.parse(userAgent);
    return {
      device: short(parsed.platform?.type),
      browser: short(parsed.browser?.name),
      os: short(parsed.os?.name)
    };
  } catch {
    return { device: null, browser: null, os: null };
  }
}

module.exports = { countryOf, sourceOf, deviceOf, cleanTag, hostOf };
