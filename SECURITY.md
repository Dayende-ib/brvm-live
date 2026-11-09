# Politique de sécurité — BRVM Live

## Signaler une vulnérabilité

Envoyez un email à **Dayende.ib@gmail.com** avec :

- **Sujet** : `Vulnérabilité de sécurité - BRVM Live`
- une description du problème et de son impact ;
- une preuve de concept minimale, sans exploitation destructive ;
- la version ou le commit concerné.

Réponse sous 48 h ouvrées. L'identité du rapporteur reste confidentielle.

## Mesures en place

### 1. Authentification et sessions

- Mot de passe administrateur haché avec **scrypt** (N=16384, r=8, p=1, sel aléatoire).
- Comparaison à temps constant (`crypto.timingSafeEqual`).
- Session stateless signée en **HMAC-SHA256**, cookie `HttpOnly`, `SameSite=Strict`,
  `Secure` en production, durée de vie limitée (8 h par défaut).
- Vérification de l'en-tête `Origin` et jeton **CSRF** sur toutes les actions POST admin.
- Limitation des tentatives de connexion (10 échecs / 15 min / IP par défaut).
- Aucun compte par défaut : si `ADMIN_PASSWORD_HASH`/`ADMIN_PASSWORD` est absent,
  l'administration est désactivée.

### 2. Comptes utilisateurs

- Mots de passe hachés avec **scrypt** (10 caractères minimum), hash factice en cas
  d'identifiant inconnu pour ne pas révéler l'existence d'un compte par le temps de réponse.
- Session stateless signée en HMAC-SHA256, cookie `HttpOnly`, `SameSite=Lax`, `Secure` en
  production, 7 jours par défaut (`USER_SESSION_TTL_MS`).
- Formulaires : vérification de l'en-tête `Origin` + jeton CSRF signé (cookie et champ caché).
- API `/api/favoris` : jeton CSRF en double soumission (cookie + en-tête `X-CSRF-Token`).
- Redirection après connexion limitée aux chemins locaux (pas de redirection ouverte).
- Limites par IP : inscriptions réussies (5 / 15 min), échecs de connexion (15 / 15 min).

### 3. API

- Rate limiting : 60 requêtes / 15 min / IP en anonyme, 600 avec clé API.
- Clés API optionnelles, comparées via SHA-256 et `timingSafeEqual` ; jamais stockées en base.
- Validation stricte des paramètres avec **Zod** (symbole ≤ 20 caractères, format énuméré).
- Erreurs génériques côté client ; les détails restent dans les logs.
- Export CSV protégé contre l'injection de formules (préfixe `'` sur `=`, `+`, `-`, `@`).
- CORS restreignable via `ALLOWED_ORIGINS`.
- Requêtes SQL préparées uniquement (`node:sqlite`), aucune concaténation.

### 4. En-têtes HTTP

- **Helmet** : CSP restrictive (`default-src 'self'`, pas d'inline), `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, `Cross-Origin-*`.
- **HSTS** en production (`max-age=31536000; includeSubDomains`), à compléter par le proxy.
- `X-Robots-Tag: noindex` et `Cache-Control: no-store` sur `/admin`.

### 5. Compteur de visites

- Aucune IP ni User-Agent brut stocké.
- HMAC-SHA256 tronqué avec un sel dérivé du jour : non corrélable entre jours.
- Robots, `DNT` et `Sec-GPC` ignorés ; purge après 90 jours.
- Aucun cookie de mesure d'audience.

### 6. Exploitation

- Conteneur Docker **non-root**, système de fichiers **lecture seule** (hors volume de données),
  `cap_drop: ALL`, `no-new-privileges`, tmpfs pour `/tmp`.
- Secrets uniquement via variables d'environnement / `.env` en `chmod 600`.
- Logs JSON sur stdout, rotation par Docker ; pas d'écriture de logs dans le conteneur.
- Healthcheck `/health` et arrêt propre sur `SIGTERM`/`SIGINT`.
- Dépendances verrouillées (`package-lock.json` versionné) et `npm audit --omit=dev --audit-level=high` en CI.

## Bonnes pratiques de déploiement

1. TLS 1.2+ terminé par le reverse proxy ; HTTP redirigé vers HTTPS.
2. Application liée à `127.0.0.1:3000`, jamais exposée directement sur Internet.
3. `SESSION_SECRET` unique par déploiement (32 octets aléatoires minimum), rotation en cas de doute.
4. Clés API longues (`openssl rand -hex 24`) et révoquées en retirant la valeur de `API_KEYS`.
5. Mises à jour régulières de l'image de base Node et des dépendances.
6. Sauvegardes testées du volume SQLite avant toute mise à jour majeure.
7. Supervision de `/health`, des `5xx` et des pics de `429`.

## Limites connues

- Les rate limits sont stockés **en mémoire** : ils sont propres à chaque instance.
  Un déploiement multi-réplicas nécessite un store partagé (Redis) ou des limites au proxy.
- SQLite impose un seul conteneur applicatif en écriture.
- Le scraping dépend de la structure HTML de brvm.org ; une refonte du site peut nécessiter
  une adaptation de `src/scraper.js` (les erreurs sont journalisées et le cache de secours prend le relais).
- `API_KEYS_REQUIRED=true` coupe aussi l'accès de la page publique.
- Les sessions sont stateless : la déconnexion efface le cookie mais ne révoque pas un jeton
  déjà copié. Seul le changement de `SESSION_SECRET` invalide toutes les sessions.

## Procédure en cas d'incident

1. **Détecter** : examiner les logs (`docker compose logs app`) et les alertes `/health`.
2. **Confinement** : retirer les clés API compromises, changer `SESSION_SECRET` et le mot de passe admin.
3. **Éradiquer** : mettre à jour l'image/dépendances, corriger la cause, vérifier les accès.
4. **Récupérer** : restaurer la sauvegarde SQLite si nécessaire, redémarrer, vérifier `/health`.
5. **Documenter** : consigner la chronologie, l'impact et les mesures préventives.

## Contact

Sécurité : **Dayende.ib@gmail.com**
