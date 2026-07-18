# Politique de Sécurité - BRVM Live API

## Signalement des vulnérabilités

Si vous découvrez une vulnérabilité de sécurité dans ce projet, merci de la signaler de manière responsable.

### Comment signaler

Envoyez un email à : `Dayende.ib@gmail.com` avec :
- **Sujet** : `Vulnérabilité de sécurité - BRVM Live API`
- **Description** : Détails de la vulnérabilité
- **Preuve de concept** : Si possible, sans exploiter la vulnérabilité
- **Impact** : Potentiel impact de la vulnérabilité

### Engagements

- Nous répondrons dans les 48 heures
- Nous confirmerons la réception du signalement
- Nous garderons votre identité confidentielle
- Nous travaillerons avec vous pour corriger le problème

## Mesures de sécurité en place

### 1. Protection des API
- **Rate limiting** : 100 requêtes par 15 minutes par IP
- **Validation des entrées** : Schéma Zod pour tous les paramètres
- **CORS configuré** : Origines autorisées via variable d'environnement

### 2. Headers de sécurité
- **Helmet** : Headers HTTP sécurisés (CSP, X-Frame-Options, etc.)
- **HSTS** : Strict-Transport-Security avec max-age=31536000
- **Content-Type-Options** : Protection contre MIME-sniffing

### 3. Logging et monitoring
- **Winston** : Logging structuré des requêtes et erreurs
- **Fichiers de log** : `logs/error.log` et `logs/combined.log`
- **Horodatage** : UTC sur tous les logs

### 4. Gestion des dépendances
- **npm audit** : Script pour auditer les vulnérabilités
- **package-lock.json** : Versions de dépendances verrouillées

## Procédure en cas d'incident

### 1. Détection
- Surveillance des logs pour les activités anormales
- Alertes sur les pics d'erreurs 429 (rate limit)
- Surveillance des erreurs 500

### 2. Confinement
- Si attaque en cours : augmenter le rate limiting
- Si compromission : révoquer les secrets exposés
- Si DoS : activer des règles de firewall supplémentaires

### 3. Éradication
- Identifier la cause racine
- Appliquer le correctif
- Scanner pour d'autres compromissions

### 4. Récupération
- Restaurer depuis les sauvegardes si nécessaire
- Vérifier l'intégrité du système
- Remettre en service progressivement

### 5. Post-incident
- Documenter l'incident
- Mettre à jour les procédures
- Former l'équipe si nécessaire

## Déploiement en production

### HTTPS obligatoire
En production, l'API doit être servie via HTTPS :
- Utiliser un reverse proxy (Nginx/Apache) avec certificat TLS
- Ou utiliser un service PaaS (Vercel, Heroku, Railway) avec HTTPS automatique
- Certificat TLS 1.2 minimum, TLS 1.3 recommandé

### Variables d'environnement recommandées
```bash
PORT=3000
ALLOWED_ORIGINS=https://votre-domaine.com,https://www.votre-domaine.com
NODE_ENV=production
```

### Rotation des secrets
- Si des secrets sont ajoutés (clés API, etc.), les faire tourner tous les 90 jours
- Ne jamais committer les secrets dans le code
- Utiliser `.env` pour le développement, variables d'environnement pour la production

## Contact

Pour toute question de sécurité : `Dayende.ib@gmail.com`
