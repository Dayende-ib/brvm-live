# BRVM Live

API et interface web des cours d'actions de la **BRVM** (Bourse Régionale des Valeurs
Mobilières), alimentées par le site officiel [brvm.org](https://www.brvm.org/fr/cours-actions/0).

Le projet est conçu pour tourner sur un **VPS** avec Docker Compose et un reverse proxy
existant (Nginx, Caddy…). Il ne dépend plus de Vercel.

## Fonctionnalités

- Scraping robuste : timeout, retries, validation des données, détection des changements de structure.
- Cache SQLite persistant (30 min par défaut) avec repli sur la dernière donnée valide jusqu'à 24 h.
- API JSON et CSV, recherche par symbole, en-têtes de cache et de fraîcheur.
- Documentation API intégrée sur `/api.html` (exemples cURL, JS, Python, Sheets, copiables).
- Interface responsive : recherche instantanée, tri, résumé du marché, export CSV, actualisation automatique.
- Compteur de visites respectueux de la vie privée (aucune IP brute stockée).
- Administration protégée par mot de passe (scrypt, cookie signé HttpOnly/SameSite, CSRF).
- Clés API optionnelles avec quotas supérieurs.
- Rate limiting sur l'API, les visites et la connexion admin.
- Healthcheck, arrêt propre, logs JSON sur stdout, conteneur Docker non-root.
- Tests, ESLint et CI GitHub Actions.

## Architecture

```
server.js                 démarrage, graceful shutdown, purge des visites
src/
  app.js                  application Express (sécurité, routes, statique)
  config.js               validation des variables d'environnement (Zod)
  scraper.js              récupération et parsing de brvm.org
  cache.js                cache SQLite + repli sur données périmées
  db.js                   SQLite (node:sqlite), migrations, requêtes
  security.js             scrypt, sessions signées, hachage IP, clés API
  logger.js               Winston (stdout)
  middleware/             auth, rate limiting, compteur de visites
  routes/                 API publique et administration
public/                   interface (HTML/CSS/JS sans build)
tests/                    tests node:test + supertest
deploy/nginx.conf.example exemple de reverse proxy
```

## Démarrage local

Prérequis : **Node.js 24.x**.

```bash
npm ci
cp .env.example .env
```

Renseignez au minimum dans `.env` :

```bash
NODE_ENV=development
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD=mot-de-passe-local
```

`ADMIN_PASSWORD` en clair est accepté en développement (il est haché en mémoire au
démarrage). En production, utilisez `ADMIN_PASSWORD_HASH`.

```bash
npm run dev
```

- Interface : <http://localhost:3000>
- Administration : <http://localhost:3000/admin>
- Santé : <http://localhost:3000/health>

Les données (SQLite) sont créées dans `./data/`.

## Configuration

Toutes les variables sont optionnelles sauf `SESSION_SECRET` en production.

| Variable | Défaut | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` active HSTS, cookies `Secure` et logs JSON. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Écoute HTTP. |
| `DATA_DIR` | `./data` | Répertoire du fichier SQLite. |
| `SESSION_SECRET` | — | **Requis en production**, 32 caractères minimum. |
| `ADMIN_USERNAME` | `admin` | Identifiant de l'administration. |
| `ADMIN_PASSWORD_HASH` | — | Hash scrypt généré par `npm run hash-password`. |
| `ADMIN_PASSWORD` | — | Mot de passe en clair (développement uniquement). |
| `SESSION_TTL_MS` | `28800000` | Durée de session admin (8 h). |
| `API_KEYS` | — | Clés séparées par des virgules. |
| `API_KEYS_REQUIRED` | `false` | Si `true`, `/api/*` exige une clé (voir avertissement plus bas). |
| `ALLOWED_ORIGINS` | `*` | Origines CORS séparées par des virgules. |
| `TRUST_PROXY` | `1` | Nombre de proxies de confiance devant l'application. |
| `SOURCE_URL` | page officielle | URL scrapée. |
| `CACHE_TTL_MS` | `1800000` | Durée du cache frais (30 min). |
| `CACHE_MAX_STALE_MS` | `86400000` | Durée maximale du cache de secours (24 h). |
| `SCRAPE_TIMEOUT_MS` | `10000` | Timeout par tentative. |
| `SCRAPE_RETRIES` | `2` | Nombre de nouvelles tentatives. |
| `VISITS_RETENTION_DAYS` | `90` | Purge des visites plus anciennes. |
| `RATE_LIMIT_*` | voir `.env.example` | Quotas par fenêtre de 15 min. |

Générer le hash du mot de passe admin :

```bash
printf '%s' 'mon-mot-de-passe' | npm run hash-password
```

Copiez la ligne `ADMIN_PASSWORD_HASH=...` affichée dans `.env`.

> `API_KEYS_REQUIRED=true` bloque **tous** les appels `/api/*`, y compris ceux de la page
> publique. À réserver aux déploiements API privés. Pour un site public, laissez `false` :
> les clés API donnent seulement un quota supérieur (600 au lieu de 60 requêtes/15 min).

## API

Une documentation complète et copiable est disponible dans l'interface : **`/api.html`**.
La suite ci-dessous en présente l'essentiel.

### `GET /api/cours`

Toutes les actions en JSON.

```bash
curl -s https://brvm.example.com/api/cours | jq
```

```json
{
  "maj": "Vendredi, 6 novembre, 2026 - 22:45",
  "nombre": 48,
  "actions": [
    {
      "symbole": "ABJC",
      "nom": "SERVAIR ABIDJAN COTE D'IVOIRE",
      "volume": 3026,
      "cours_veille": 3395,
      "ouverture": 3400,
      "cloture": 3400,
      "variation_pct": 0.15
    }
  ],
  "source": "https://www.brvm.org/fr/cours-actions/0",
  "recupere_le": "2026-11-08T21:42:07.000Z",
  "mis_a_jour_le": "2026-11-08T21:42:07.000Z",
  "perime": false
}
```

En-têtes utiles :

- `X-Data-Source` : `cache`, `fresh` ou `stale`.
- `X-Data-Updated-At` : date ISO de la dernière récupération réussie.
- `Warning: 110` + `Cache-Control: no-store` si les données servies sont périmées.
- `Cache-Control: public, max-age=60, s-maxage=1800, stale-while-revalidate=86400` sinon.

### `GET /api/cours?symbole=ONTBF`

Une seule action. Renvoie `404` avec la liste des symboles disponibles si inconnu.

### `GET /api/cours?format=csv`

Export CSV (UTF-8 avec BOM, compatible Excel/Sheets). Les cellules texte sont protégées
contre l'injection de formules.

### `GET /api/visites`

Statistiques agrégées : vues totales, visiteurs uniques cumulés (par jour), aujourd'hui et
série des 30 derniers jours.

### `GET /health`

Healthcheck : état de la base et du cache. `200` si la base répond, `503` sinon.

### Clé API

```bash
curl -H "X-API-Key: $CLE" https://brvm.example.com/api/cours
# ou
curl -H "Authorization: Bearer $CLE" https://brvm.example.com/api/cours
```

## Compteur de visites

- Compte les chargements de la page d'accueil (`GET /`, HTML uniquement).
- Ignore les robots connus, `DNT: 1` et `Sec-GPC: 1`.
- Ne stocke **jamais** l'IP ni le User-Agent : seul un HMAC tronqué `jour + IP + UA` est enregistré.
- Le sel change chaque jour : impossible de relier un visiteur d'un jour à l'autre.
- Purge automatique après `VISITS_RETENTION_DAYS` (90 jours par défaut).
- Aucun cookie de mesure d'audience n'est posé.

## Administration

`/admin` permet de consulter :

- les vues et visiteurs uniques (aujourd'hui, cumul, 30 derniers jours) ;
- l'état du cache (date, âge, nombre d'actions) et de forcer un rafraîchissement ;
- l'état du processus (Node, uptime, mémoire, chemin SQLite) ;
- la configuration active (clés API, quotas, rétention).

Protections : mot de passe scrypt, cookie signé `HttpOnly` + `SameSite=Strict` (et `Secure`
en production), vérification d'origine, jeton CSRF, limitation des tentatives de connexion.

Si aucun mot de passe n'est configuré, `/admin` est désactivé et le login l'indique.

## Déploiement sur VPS (Docker Compose)

### 1. Préparer le serveur

- Docker et le plugin Compose installés.
- Un reverse proxy (Nginx) déjà en place, avec un domaine pointant vers le VPS.
- Le port `3000` **non exposé publiquement** (le compose l'écoute sur `127.0.0.1`).

### 2. Configurer l'application

```bash
git clone <dépôt> brvm-live
cd brvm-live
cp .env.example .env
chmod 600 .env

openssl rand -hex 32          # -> SESSION_SECRET
printf '%s' 'mot-de-passe-admin' | npm run hash-password   # -> ADMIN_PASSWORD_HASH
```

Éditez `.env` avec ces valeurs, puis vérifiez que `ALLOWED_ORIGINS` contient votre domaine
(ou laissez vide pour `*`).

### 3. Lancer

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=100 app
curl -s http://127.0.0.1:3000/health | jq
```

### 4. Reverse proxy Nginx

Adaptez `deploy/nginx.conf.example` (domaine, certificats), puis :

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/brvm-live
sudo ln -s /etc/nginx/sites-available/brvm-live /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d brvm.example.com
```

Le proxy doit transmettre `Host`, `X-Real-IP`, `X-Forwarded-For` et `X-Forwarded-Proto`
(déjà présents dans l'exemple). `TRUST_PROXY=1` permet à Express de lire correctement l'IP
réelle et de sécuriser les cookies.

### 5. Mises à jour

```bash
git pull
docker compose up -d --build
docker image prune -f
```

### 6. Sauvegarde de la base

Le volume Docker s'appelle généralement `brvm-live_brvm-data`.

```bash
docker compose stop app
docker run --rm \
  -v brvm-live_brvm-data:/data:ro \
  -v "$PWD:/backup" \
  alpine tar czf "/backup/brvm-data-$(date +%F).tar.gz" -C /data .
docker compose start app
```

Automatisez cette commande avec une tâche cron et testez régulièrement la restauration.

### 7. Logs et supervision

Les logs sont écrits sur stdout en JSON et rotatés par Docker (`10 Mo`, 3 fichiers).

```bash
docker compose logs -f app
docker stats brvm-live
```

Surveillez `GET /health` (Uptime Kuma, Better Stack, etc.) et les codes `5xx`/`429`.

### Variante : proxy dans Docker

Si Nginx tourne lui aussi dans Docker, retirez la section `ports` et placez les deux
services sur un réseau Compose commun ; utilisez alors `proxy_pass http://app:3000;`.

## Développement et qualité

```bash
npm test          # tests node:test + supertest
npm run lint      # ESLint
npm run audit     # vulnérabilités des dépendances
```

La CI GitHub Actions exécute le lint, les tests et le build de l'image Docker à chaque
push sur `main` et à chaque pull request.

## Sécurité

Voir [SECURITY.md](SECURITY.md) pour la politique de signalement et le détail des mesures.

Points importants pour l'exploitation :

- Ne jamais committer `.env` ; garder `chmod 600`.
- Générer des secrets longs (`openssl rand -hex 32`) et des clés API (`openssl rand -hex 24`).
- Garder l'application liée à `127.0.0.1` et laisser le TLS au reverse proxy.
- Les rate limits sont en mémoire : ils sont par instance. Pour plusieurs réplicas,
  utilisez un store partagé (Redis) ou limitez au niveau du proxy.
- Le cache et les visites vivent dans un seul fichier SQLite : un seul conteneur applicatif
  à la fois (pas de scale horizontal sans revoir le stockage).

## Licence et données

Les données appartiennent à la BRVM. Ce projet les met en cache de manière raisonnable
(30 minutes) et n'est pas un conseil en investissement. Respectez les conditions
d'utilisation de brvm.org.
