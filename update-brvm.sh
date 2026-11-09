#!/bin/bash
#
# Script de mise à jour pour BRVM Live
#   1. Vérifie s'il y a de nouveaux commits sur GitHub
#   2. Si oui : les récupère, reconstruit l'image et redémarre le conteneur
#      Si non : ne reconstruit rien (relance seulement le conteneur s'il est arrêté
#      ou si le .env a changé)
#   3. Nettoie les anciennes images Docker (après une reconstruction)
#   4. Vérifie que l'application est en bonne santé
#
# Usage : ./update-brvm.sh           mise à jour seulement si nécessaire
#         ./update-brvm.sh --force   reconstruit l'image même sans nouveau commit
#
set -euo pipefail

# Dossier du projet = dossier où se trouve ce script
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="brvm-live"

FORCE=0
case "${1:-}" in
  "") ;;
  -f|--force) FORCE=1 ;;
  *) echo "Usage : $0 [--force]"; exit 1 ;;
esac

echo "========================================="
echo "Mise à jour de BRVM Live"
echo "========================================="

cd "$PROJECT_DIR"
echo "-> Dossier : $PROJECT_DIR"

if [ ! -f .env ]; then
  echo "ERREUR : fichier .env introuvable dans $PROJECT_DIR"
  exit 1
fi

echo "-> Vérification des nouveautés sur GitHub..."
git fetch --quiet || { echo "ERREUR : échec de git fetch (réseau ou accès au dépôt ?)"; exit 1; }

if ! git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  echo "ERREUR : la branche courante ne suit aucune branche distante (git branch -u origin/main)"
  exit 1
fi

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse '@{u}')"
BUILD=0

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "-> Nouveaux commits :"
  git log --oneline "HEAD..@{u}" | sed 's/^/     /'
  echo "-> Récupération des modifications..."
  git pull --ff-only || { echo "ERREUR : échec de git pull (modifs locales ou historique divergent ?)"; exit 1; }
  BUILD=1
elif [ "$FORCE" -eq 1 ]; then
  echo "-> Déjà à jour ($(git rev-parse --short HEAD)), reconstruction forcée (--force)."
  BUILD=1
else
  echo "-> Déjà à jour ($(git rev-parse --short HEAD)) : pas de reconstruction de l'image."
fi

if [ "$BUILD" -eq 1 ]; then
  echo "-> Reconstruction et redémarrage des containers..."
  docker compose up -d --build || { echo "ERREUR : échec de docker compose up"; exit 1; }

  echo "-> Nettoyage des anciennes images Docker..."
  docker image prune -f >/dev/null 2>&1 || true
else
  # Sans --build, Compose ne fait rien si tout tourne déjà avec la même configuration ;
  # il relance le conteneur s'il est arrêté ou le recrée si le .env a changé.
  echo "-> Vérification du conteneur (sans reconstruction)..."
  docker compose up -d || { echo "ERREUR : échec de docker compose up"; exit 1; }
fi

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
