# BRVM Live API

API de cours BRVM (scraping poli du site officiel brvm.org) avec cache pour ménager le site source.

## 🚀 Démarrage rapide

### Installation
```bash
npm install
```

### Démarrage (développement)
```bash
npm start
```

L'API sera accessible sur `http://localhost:3000`

## 📡 Endpoints

### GET /
Informations sur l'API et ses endpoints.

### GET /api/cours
Récupère toutes les actions BRVM en JSON.

**Réponse :**
```json
{
  "maj": "Dernière mise à jour",
  "nombre": 42,
  "actions": [...]
}
```

### GET /api/cours?symbole=ONTBF
Récupère une action spécifique par son symbole.

**Réponse :**
```json
{
  "maj": "Dernière mise à jour",
  "nombre": 1,
  "actions": [{
    "symbole": "ONTBF",
    "nom": "ONTANG",
    "volume": 1000,
    "cours_veille": 15000,
    "ouverture": 15200,
    "cloture": 15100,
    "variation_pct": 0.67
  }]
}
```

### GET /api/cours?format=csv
Récupère toutes les actions en CSV (pour Google Sheets / Excel).

## 🔒 Sécurité

### Mesures en place
- **Rate limiting** : 100 requêtes par 15 minutes par IP
- **Headers de sécurité** : Helmet (CSP, HSTS, X-Frame-Options, etc.)
- **Validation des entrées** : Zod pour tous les paramètres
- **Logging** : Winston avec logs structurés
- **CORS** : Configurable via variable d'environnement

### Audit de sécurité
```bash
npm run audit      # Vérifier les vulnérabilités
npm run audit:fix  # Corriger automatiquement
```

Voir [SECURITY.md](SECURITY.md) pour plus de détails.

## 🌐 Déploiement en production

### HTTPS obligatoire

Pour un déploiement en production, l'API doit être servie via HTTPS. Plusieurs options :

#### Option 1 : Vercel (recommandé)
1. Installer Vercel CLI : `npm i -g vercel`
2. Déployer : `vercel`
3. HTTPS est automatique avec Vercel

#### Option 2 : Reverse proxy Nginx
```nginx
server {
    listen 443 ssl http2;
    server_name votre-domaine.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### Option 3 : Heroku / Railway
Ces services PaaS fournissent HTTPS automatiquement.

### Variables d'environnement
```bash
PORT=3000
ALLOWED_ORIGINS=https://votre-domaine.com,https://www.votre-domaine.com
NODE_ENV=production
```

## 📝 Scripts

- `npm start` - Démarrer le serveur
- `npm run audit` - Auditer les dépendances
- `npm run audit:fix` - Corriger les vulnérabilités automatiquement

## 📄 Licence

Ce projet scrape les données de brvm.org de manière respectueuse (cache 30 min). Respectez les conditions d'utilisation du site source.
