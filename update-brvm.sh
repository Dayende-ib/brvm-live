#!/bin/bash
#
# Script de mise à jour automatiques pour BRVM Live
# Ce script :
#   1. Récupère les dernières modifications depuis GitHub
#   2. Reconstruit et redémarre les containers Docker
#   3. Nettoie les anciennes images Docker
#
# À exécuter manuellement quand vous voulez mettre à jour le projet.
#

set -e

# Dossier du projet
PROJECT_DIR="/home/dayende/projects/brvm-live"

echo "========================================="
echo "Mise à jour de BRVM Live"
echo "========================================="
echo ""

# 1. Se placer dans le dossier du projet
echo "-> Passage dans $PROJECT_DIR"
cd "$PROJECT_DIR" || {
  echo "ERREUR : Impossible d'accéder à $PROJECT_DIR"
  exit 1
}

# 2. Récupérer les dernières modifications depuis GitHub
echo "-> récupération des dernières modifications depuis GitHub..."
git pull || {
  echo "ERREUR : Échec de git pull"
  exit 1
}

# 3. Reconstruire et redémarrer les containers Docker
echo "-> Reconstruction et redémarrage des containers..."
docker compose up -d --build || {
  echo "ERREUR : Échec de docker compose up"
  exit 1
}

# 4. Nettoyer les anciennes images Docker (optionnel)
echo "-> Nettoyage des anciennes images Docker..."
docker image prune -f 2>/dev/null || true

# 5. Vérifier que l'application est bien en cours d'exécution
echo "-> Vérification de l'état du service..."
if docker compose ps | grep -q "Up"; then
  echo "-> Application en cours d'exécution."
  # Test santé
  HEALTH=$(docker compose exec app node -e "fetch('http://127.0.0.1:3000/health').then(r => r.ok ? 'OK' : 'FAIL').catch(() => 'FAIL')")
  echo "-> Healthcheck : $HEALTH"
else
  echo "ERREUR : L'application ne tourne pas."
  exit 1
fi

echo ""
echo "========================================="
echo "Mise à jour terminée avec succès !"
echo "========================================="
echo ""
echo "Pour vérifier :"
echo "  - Healthcheck : curl http://127.0.0.1:3000/health"
echo "   - API publique : curl http://127.0.0.1:3000/api/cours"