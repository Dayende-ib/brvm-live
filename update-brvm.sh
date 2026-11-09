#!/bin/bash
#
# Script de mise à jour pour BRVM Live
#   1. Récupère les dernières modifications depuis GitHub
#   2. Reconstruit et redémarre les containers Docker
#   3. Nettoie les anciennes images Docker
#   4. Vérifie que l'application est en bonne santé
#
set -euo pipefail

# Dossier du projet = dossier où se trouve ce script
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="brvm-live"

echo "========================================="
echo "Mise à jour de BRVM Live"
echo "========================================="

cd "$PROJECT_DIR"
echo "-> Dossier : $PROJECT_DIR"

if [ ! -f .env ]; then
  echo "ERREUR : fichier .env introuvable dans $PROJECT_DIR"
  exit 1
fi

echo "-> Récupération des modifications depuis GitHub..."
git pull --ff-only || { echo "ERREUR : échec de git pull (modifs locales ou historique divergent ?)"; exit 1; }

echo "-> Reconstruction et redémarrage des containers..."
docker compose up -d --build || { echo "ERREUR : échec de docker compose up"; exit 1; }

echo "-> Nettoyage des anciennes images Docker..."
docker image prune -f >/dev/null 2>&1 || true

echo "-> Attente du healthcheck (max 60s)..."
STATUS="starting"
for _ in $(seq 1 30); do
  STATUS=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "absent")
  [ "$STATUS" = "healthy" ] && break
  [ "$STATUS" = "unhealthy" ] && break
  sleep 2
done

if [ "$STATUS" != "healthy" ]; then
  echo "ERREUR : l'application n'est pas saine (état : $STATUS)"
  echo "-> Derniers logs :"
  docker compose logs --tail=30 app
  exit 1
fi

echo "-> Healthcheck : OK"
echo ""
echo "========================================="
echo "Mise à jour terminée avec succès !"
echo "========================================="
echo "Pour vérifier :"
echo "  - Healthcheck  : curl http://127.0.0.1:3000/health"
echo "  - API publique : curl http://127.0.0.1:3000/api/cours"
