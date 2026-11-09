# BRVM Live

API et interface web des cours d'actions de la **BRVM** (Bourse Régionale des Valeurs
Mobilières), alimentées par le site officiel [brvm.org](https://www.brvm.org/fr/cours-actions/0).

Le projet est conçu pour tourner sur un **VPS** avec Docker Compose et un reverse proxy
existant (Nginx, Caddy…). Il ne dépend plus de Vercel.

## Fonctionnalités

- Scraping robuste : timeout, retries, validation des données, détection des changements de structure.
- Cache SQLite persistant (30 min par défaut), rafraîchi en arrière-plan avant expiration, avec
  repli sur la dernière donnée valide jusqu'à 24 h et pause d'une minute après un échec de brvm.org.
- API JSON et CSV, recherche par symbole, en-têtes de cache et de fraîcheur.
- Documentation API intégrée sur `/api.html` (exemples cURL, JS, Python, Sheets, copiables).
- Interface responsive : recherche instantanée, tri, résumé du marché, export CSV, actualisation automatique.
- Comptes utilisateurs (inscription, connexion, page « Mon compte ») et actions favorites.
- Compteur de visites respectueux de la vie privée (aucune IP brute stockée).
- Administration protégée par mot de passe (scrypt, cookie signé HttpOnly/SameSite, CSRF).
- Clés API optionnelles avec quotas supérieurs.
- Rate limiting sur l'API, les visites, l'inscription et les connexions.
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
  routes/
    api.js                API publique (/api/cours, /api/visites)
    users.js              comptes, favoris (/inscription, /connexion, /compte, /api/session, /api/favoris)
    admin.js              administration (/admin)
  utils/html.js           échappement et formatage HTML
  routes/pages.js         accueil, doc API, fiches actions, robots.txt, sitemap.xml (rendu serveur)
  seo.js                  balises <head>, JSON-LD, rendu du tableau
  views/                  modèles HTML de l'accueil et de la documentation API
public/                   CSS, JS et fichiers statiques (sans build)
scripts/hash-password.js  génération du hash du mot de passe admin
tests/                    tests node:test + supertest
deploy/nginx.conf.example exemple de reverse proxy
update-brvm.sh            mise à jour en un coup sur le VPS (git pull + rebuild + healthcheck)
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

Gardez `NODE_ENV=development` en local : en `production`, les cookies sont `Secure` et la
connexion ne fonctionne pas sur `http://localhost`.

```bash
npm run dev
```

`npm run dev` et `npm start` chargent automatiquement `.env` (option `--env-file-if-exists`
de Node). Les variables déjà définies dans l'environnement restent prioritaires.

- Interface : <http://localhost:3000>
- Administration : <http://localhost:3000/admin>
- Santé : <http://localhost:3000/health>

Les données (SQLite) sont créées dans `./data/`.

## Configuration

Toutes les variables sont optionnelles sauf `SESSION_SECRET` en production. Une variable
laissée vide (`CLE=`) est traitée comme absente.

| Variable | Défaut | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` active HSTS, cookies `Secure` et logs JSON. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Écoute HTTP. |
| `DATA_DIR` | `./data` | Répertoire du fichier SQLite. |
| `PUBLIC_URL` | hôte de la requête | URL publique (`https://votre-domaine`), utilisée pour les URL canoniques, le sitemap et les balises de partage. **Recommandé en production.** |
| `SESSION_SECRET` | - | **Requis en production**, 32 caractères minimum. |
| `ADMIN_USERNAME` | `admin` | Identifiant de l'administration. |
| `ADMIN_PASSWORD_HASH` | - | Hash scrypt généré par `npm run hash-password`. |
| `ADMIN_PASSWORD` | - | Mot de passe en clair (développement uniquement). |
| `SESSION_TTL_MS` | `28800000` | Durée de session admin (8 h). |
| `USER_SESSION_TTL_MS` | `604800000` | Durée de session des comptes utilisateurs (7 jours). |
| `API_KEYS` | - | Clés séparées par des virgules. |
| `API_KEYS_REQUIRED` | `false` | Si `true`, `/api/*` exige une clé (voir avertissement plus bas). |
| `ALLOWED_ORIGINS` | `*` | Origines CORS séparées par des virgules. |
| `TRUST_PROXY` | `1` | Nombre de proxies de confiance devant l'application. |
| `SOURCE_URL` | page officielle | URL scrapée. |
| `CACHE_TTL_MS` | `1800000` | Durée du cache frais (30 min). |
| `CACHE_MAX_STALE_MS` | `86400000` | Durée maximale du cache de secours (24 h). |
| `SCRAPE_TIMEOUT_MS` | `10000` | Timeout par tentative. |
| `SCRAPE_RETRIES` | `2` | Nombre de nouvelles tentatives. |
| `SCRAPE_FAILURE_COOLDOWN_MS` | `60000` | Pause avant de retenter brvm.org après un échec (le cache de secours est servi entre-temps). |
| `VISITS_RETENTION_DAYS` | `90` | Purge des visites plus anciennes. |
| `RATE_LIMIT_*` | voir `.env.example` | Quotas par fenêtre de 15 min (API, visites, admin, inscription, connexion, compte). |

Générer le hash du mot de passe admin (12 caractères minimum) :

```bash
printf '%s' 'mon-mot-de-passe' | npm run hash-password
```

Copiez la ligne `ADMIN_PASSWORD_HASH='...'` affichée dans `.env`, **apostrophes comprises** :
le hash contient des `$` que Docker Compose interpréterait comme des variables sans elles
(la connexion admin échouerait alors sans message clair). Au démarrage, l'application
affiche un avertissement si le hash reçu n'a pas le format attendu.

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

## Référencement (SEO)

- **Rendu côté serveur** : la page d'accueil contient directement le tableau des cours et le
  résumé du marché dans son HTML (modèles dans `src/views/`). Les robots voient le contenu sans
  exécuter JavaScript ; `public/app.js` prend ensuite le relais (tri, recherche, favoris).
- **Une fiche par action** sur `/action/<SYMBOLE>` (ex. `/action/SNTS`) : titre et description
  dédiés, chiffres clés, résumé de la séance, classement du jour et liens vers les autres actions.
  Une URL en minuscules redirige (301) vers la version en majuscules.
- **Balises** : `<title>`, `description`, URL canonique, Open Graph et Twitter sur chaque page publique ;
  `noindex` sur les pages de compte, d'erreur et d'administration, `X-Robots-Tag: noindex` sur `/api/*`.
- **Données structurées** (JSON-LD) : `WebSite` et `Dataset` sur l'accueil (avec les téléchargements
  JSON et CSV), `BreadcrumbList` et `WebPage` sur les fiches.
- **`/robots.txt`** et **`/sitemap.xml`** générés dynamiquement (accueil, documentation et toutes les
  fiches, avec la date de dernière mise à jour).

Après la mise en ligne : définir `PUBLIC_URL`, déclarer le site dans
[Google Search Console](https://search.google.com/search-console) et
[Bing Webmaster Tools](https://www.bing.com/webmasters), puis y soumettre `https://votre-domaine/sitemap.xml`.

## Compteur de visites

- Compte les chargements de la page d'accueil (`GET /`, HTML uniquement).
- Ignore les robots connus, `DNT: 1` et `Sec-GPC: 1`.
- Ne stocke **jamais** l'IP ni le User-Agent : seul un HMAC tronqué `jour + IP + UA` est enregistré.
- Le sel change chaque jour : impossible de relier un visiteur d'un jour à l'autre.
- Purge automatique après `VISITS_RETENTION_DAYS` (90 jours par défaut).
- Aucun cookie de mesure d'audience n'est posé.

## Comptes utilisateurs et favoris

- Inscription sur `/inscription` (nom d'utilisateur, email, mot de passe de 10 caractères minimum),
  connexion sur `/connexion` avec le nom d'utilisateur ou l'email.
- Les étoiles du tableau des cours ajoutent ou retirent une action des favoris ; le filtre
  « Mes favoris » et la page `/compte` les affichent avec leur cotation.
- Mots de passe hachés avec scrypt ; session dans un cookie signé `HttpOnly`, `SameSite=Lax`
  (`Secure` en production), valable 7 jours (`USER_SESSION_TTL_MS`).
- Formulaires protégés par vérification d'origine et jeton CSRF ; l'API `/api/favoris` exige
  l'en-tête `X-CSRF-Token` fourni par `/api/session`.
- Inscriptions limitées par IP (seules les inscriptions réussies comptent), échecs de connexion
  limités par IP.
- Section « Sécurité » de `/compte` :
  - **changer de mot de passe** (mot de passe actuel requis ; les autres appareils sont déconnectés) ;
  - **déconnecter les autres appareils** (en cas d'appareil perdu ou partagé) ;
  - **supprimer le compte** (nom d'utilisateur recopié + mot de passe) : le compte, l'email et
    les favoris sont effacés définitivement.
- Chaque compte a une version de session en base : l'incrémenter invalide immédiatement tous
  les cookies émis avant (changement de mot de passe, « déconnecter les autres appareils »).

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

# -> ADMIN_PASSWORD_HASH (sans Node installé sur le VPS, via une image Node jetable)
printf '%s' 'mot-de-passe-admin' | \
  docker run --rm -i -v "$PWD":/app:ro -w /app node:24-alpine node scripts/hash-password.js
```

Éditez `.env` avec ces valeurs (hash entre apostrophes : `ADMIN_PASSWORD_HASH='scrypt$...'`), puis vérifiez que `ALLOWED_ORIGINS` contient votre domaine
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

Pour vérifier que le hash est arrivé intact dans le conteneur :

```bash
docker compose exec app printenv ADMIN_PASSWORD_HASH   # doit commencer par scrypt$16384$
```

### 5. Mises à jour

Le script `update-brvm.sh` fait tout en une commande depuis le dossier du projet :

```bash
./update-brvm.sh
```

Il vérifie la présence de `.env`, puis compare le commit local à celui de GitHub :

- **nouveaux commits** : il les affiche, fait un `git pull --ff-only`, reconstruit l'image,
  redémarre le conteneur et nettoie les anciennes images ;
- **déjà à jour** : il ne reconstruit rien ; il relance seulement le conteneur s'il est arrêté,
  ou le recrée si `.env` a changé ;
- `./update-brvm.sh --force` reconstruit l'image même sans nouveau commit.

Il attend ensuite que le healthcheck Docker passe à `healthy` (60 s max). En cas d'échec, il
affiche les derniers logs et sort avec un code d'erreur. Équivalent manuel :

```bash
git pull --ff-only
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
