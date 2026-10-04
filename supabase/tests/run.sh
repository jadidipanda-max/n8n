#!/usr/bin/env bash
# Tests de la base du cockpit sur un Postgres local (Supabase simulé).
#  1. démarre le cluster local si besoin (pg_ctlcluster) ;
#  2. crée une base jetable ;
#  3. installe le stub Supabase (auth.users, auth.uid(), rôles anon / authenticated / service_role) ;
#  4. applique la migration deux fois (idempotence) puis les données d'exemple deux fois ;
#  5. lance les assertions SQL et compte les « ok » et les « ECHEC ».
# Usage : supabase/tests/run.sh        (GARDER_BASE=1 pour garder la base après les tests)
# Variables : PG_VERSION (16), PG_CLUSTER (main), PG_SUPERUSER (postgres).
set -euo pipefail

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RACINE="$(cd "$ICI/.." && pwd)"
MIGRATION="$RACINE/migrations/20261003000000_cockpit.sql"
SEED="$RACINE/seed_demo.sql"
PG_VERSION="${PG_VERSION:-16}"
PG_CLUSTER="${PG_CLUSTER:-main}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"
BASE="cockpit_test_$(date +%s)_$$"
SORTIE="$(mktemp)"

# psql en super-utilisateur sur la base $1 (via su si on est root) ; le SQL arrive par l'entrée standard
psql_su() {
  if [ "$(id -u)" = "0" ] && [ "$PG_SUPERUSER" != "root" ]; then
    su "$PG_SUPERUSER" -c "psql -X -q -v ON_ERROR_STOP=1 -d $1"
  else
    psql -X -q -v ON_ERROR_STOP=1 -U "$PG_SUPERUSER" -d "$1"
  fi
}

nettoyer() {
  if [ "${GARDER_BASE:-0}" = "1" ]; then
    echo "Base gardée : $BASE"
  else
    echo "drop database if exists $BASE with (force);" | psql_su postgres >/dev/null 2>&1 || true
  fi
  rm -f "$SORTIE"
}
trap nettoyer EXIT

# 1. Cluster local
if command -v pg_lsclusters >/dev/null 2>&1; then
  if ! pg_lsclusters --no-header 2>/dev/null | awk -v v="$PG_VERSION" -v c="$PG_CLUSTER" '$1 == v && $2 == c && $4 == "online"' | grep -q .; then
    echo "Démarrage du cluster Postgres $PG_VERSION/$PG_CLUSTER…"
    pg_ctlcluster "$PG_VERSION" "$PG_CLUSTER" start
  fi
fi
for _ in $(seq 1 30); do
  echo "select 1;" | psql_su postgres >/dev/null 2>&1 && break
  sleep 0.5
done

# 2. Base jetable
echo "create database $BASE;" | psql_su postgres >/dev/null
echo "Base jetable : $BASE"

# 3 à 5. Tout passe par l'entrée standard (le compte postgres n'a pas besoin de lire les fichiers)
etape() {
  local nom="$1"; shift
  if ! cat "$@" | psql_su "$BASE" >>"$SORTIE" 2>&1; then
    echo "ERREUR SQL pendant : $nom (arrêt)"
    grep -E '(ERROR|DETAIL|HINT|CONTEXT):' "$SORTIE" | tail -n 10
    sed -n 's/^.*NOTICE:  ECHEC - /  échec : /p' "$SORTIE"
    echo "Résultat : $(grep -c 'NOTICE:  ok - ' "$SORTIE" || true) ok avant l'arrêt, ERREUR"
    exit 1
  fi
}
etape "stub Supabase"            "$ICI/stub_supabase.sql"
etape "migration"                "$MIGRATION"
etape "migration (2e passage)"   "$MIGRATION"
etape "données d'exemple"        "$SEED"
etape "données (2e passage)"     "$SEED"
etape "assertions" "$ICI/outils.sql" "$ICI/01_structure.sql" "$ICI/02_rls.sql" \
                   "$ICI/03_actions_autonomie.sql" "$ICI/04_cash.sql" "$ICI/05_seuils_partage.sql"

# Bilan
NB_OK=$(grep -c 'NOTICE:  ok - ' "$SORTIE" || true)
NB_ECHEC=$(grep -c 'NOTICE:  ECHEC - ' "$SORTIE" || true)
if [ "${VERBEUX:-0}" = "1" ]; then
  sed -n 's/^.*NOTICE:  //p' "$SORTIE"
fi
if [ "$NB_ECHEC" != "0" ]; then
  echo "Échecs :"
  sed -n 's/^.*NOTICE:  ECHEC - /  - /p' "$SORTIE"
fi
# Avertissements inattendus (autre chose que nos NOTICE). Celui sur wal_level vient du
# cluster local (wal_level = replica) quand on crée la publication Realtime : on l'ignore.
ATTENDU='wal_level is insufficient to publish logical changes'
if grep -E '(WARNING|ERROR):' "$SORTIE" | grep -v -F "$ATTENDU" >/dev/null; then
  echo "Messages inattendus de Postgres :"
  grep -E '(WARNING|ERROR):' "$SORTIE" | grep -v -F "$ATTENDU" | head -n 20
  NB_ECHEC=$((NB_ECHEC + 1))
fi
echo "Résultat : $NB_OK ok, $NB_ECHEC échec(s)"
[ "$NB_ECHEC" = "0" ] && [ "$NB_OK" -gt 0 ]
