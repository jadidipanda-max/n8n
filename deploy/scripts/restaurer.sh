#!/usr/bin/env bash
# Restaure une sauvegarde faite par sauvegarde.sh : volumes n8n et Caddy, deploy/.env, puis Hermès.
# À lancer avec sudo :  sudo bash /opt/jsquare/deploy/scripts/restaurer.sh /var/backups/jsquare/jsquare-….tar.gz
# Sur un serveur neuf : installer-vps.sh d'abord (et installer-hermes.sh pour restaurer Hermès).
# Le deploy/.env actuel est gardé à côté (.env.avant-restauration-…) avant d'être remplacé.
# Option : --oui (ne pas demander de confirmation).
set -euo pipefail

UTILISATEUR_HERMES="${UTILISATEUR_HERMES:-hermes}"
VOLUMES=(jsquare_n8n_data jsquare_caddy_data)
DOSSIER_DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

etape() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
erreur() {
  printf '\nERREUR : %s\n' "$*" >&2
  exit 1
}

archive=""
confirmer=1
for arg in "$@"; do
  case "$arg" in
    --oui) confirmer=0 ;;
    -h | --help)
      sed -n '2,6p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) erreur "option inconnue : $arg" ;;
    *) archive="$arg" ;;
  esac
done

[[ $EUID -eq 0 ]] || erreur "lance ce script avec sudo : sudo bash $0 <archive>"
[[ -n "$archive" ]] || erreur "indique l'archive à restaurer. Les sauvegardes : sudo ls -lt /var/backups/jsquare"
[[ -f "$archive" ]] || erreur "archive introuvable : $archive"
command -v docker >/dev/null || erreur "Docker n'est pas installé (lance d'abord installer-vps.sh)"

travail="$(mktemp -d /tmp/jsquare-restauration-XXXXXX)"
dossier_import=""
nettoyer() {
  rm -rf "$travail"
  if [[ -n "$dossier_import" ]]; then rm -rf "$dossier_import"; fi
}
trap nettoyer EXIT
chmod 700 "$travail"

etape "Lecture de l'archive"
tar -xzf "$archive" -C "$travail" || erreur "archive illisible ou abîmée : $archive"
[[ -f "$travail/LISEZMOI.txt" ]] || erreur "ce n'est pas une sauvegarde du cockpit (LISEZMOI.txt absent)"
head -n1 "$travail/LISEZMOI.txt" | sed 's/^/    /'
for f in "${VOLUMES[@]/%/.tar}" deploy.env hermes.zip; do
  if [[ -f "$travail/$f" ]]; then info "trouvé : $f"; else info "absent : $f (ne sera pas restauré)"; fi
done

if ((confirmer)); then
  quoi="n8n et Caddy"
  if [[ -f "$travail/hermes.zip" ]]; then quoi="n8n, Caddy et Hermès"; fi
  printf '\n    Les données actuelles de %s seront REMPLACÉES.\n' "$quoi"
  read -r -p "    Tape oui pour continuer : " reponse || true
  [[ "$reponse" == oui ]] || erreur "restauration annulée, rien n'a été changé."
fi

compose=(docker compose --project-directory "$DOSSIER_DEPLOY")

# ─── 1. Réglages (avant tout : la clé de chiffrement de n8n doit aller avec ses données) ──
if [[ -f "$travail/deploy.env" ]]; then
  etape "Réglages deploy/.env"
  proprietaire="$(stat -c %U "$DOSSIER_DEPLOY")"
  if [[ -f "$DOSSIER_DEPLOY/.env" ]]; then
    if cmp -s "$DOSSIER_DEPLOY/.env" "$travail/deploy.env"; then
      info "Identiques à la sauvegarde : rien à changer."
    else
      copie="$DOSSIER_DEPLOY/.env.avant-restauration-$(date '+%Y%m%d-%H%M%S')"
      install -m 600 -o "$proprietaire" "$DOSSIER_DEPLOY/.env" "$copie"
      info "Ancien fichier gardé : $copie"
    fi
  fi
  install -m 600 -o "$proprietaire" "$travail/deploy.env" "$DOSSIER_DEPLOY/.env"
  info "Restaurés."
fi
[[ -f "$DOSSIER_DEPLOY/.env" ]] || erreur "deploy/.env manque et n'est pas dans l'archive : lance d'abord configurer.sh"

# ─── 2. Volumes Docker ──────────────────────────────────────────────────────
etape "Arrêt des services (les volumes sont gardés)"
"${compose[@]}" down
# Recrée conteneurs et volumes sans les démarrer (volumes vides sur un serveur neuf).
"${compose[@]}" up --no-start

for volume in "${VOLUMES[@]}"; do
  [[ -f "$travail/$volume.tar" ]] || continue
  etape "Volume $volume"
  point="$(docker volume inspect -f '{{ .Mountpoint }}' "$volume")"
  [[ -d "$point" ]] || erreur "dossier du volume $volume introuvable : $point"
  find "$point" -mindepth 1 -delete
  tar --numeric-owner -xpf "$travail/$volume.tar" -C "$point"
  info "Restauré."
done

etape "Redémarrage des services"
"${compose[@]}" up -d
info "Services relancés."

# ─── 3. Hermès (commande officielle « hermes import ») ──────────────────────
if [[ -f "$travail/hermes.zip" ]]; then
  etape "Hermès"
  maison="$(getent passwd "$UTILISATEUR_HERMES" | cut -d: -f6 || true)"
  bin_hermes="${HERMES_BIN:-$maison/.local/bin/hermes}"
  if [[ -z "$maison" || ! -x "$bin_hermes" ]]; then
    info "Hermès n'est pas installé ici. Lance d'abord installer-hermes.sh, puis relance cette restauration."
  else
    uid="$(id -u "$UTILISATEUR_HERMES")"
    # Copie lisible par le compte d'Hermès seulement, effacée à la fin.
    dossier_import="$(mktemp -d /tmp/jsquare-import-XXXXXX)"
    chown "$UTILISATEUR_HERMES" "$dossier_import"
    install -m 600 -o "$UTILISATEUR_HERMES" "$travail/hermes.zip" "$dossier_import/hermes.zip"
    en_tant_que_hermes=(runuser -u "$UTILISATEUR_HERMES" -- env HOME="$maison"
      XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus"
      PATH="$maison/.local/bin:/usr/local/bin:/usr/bin:/bin")
    # La doc d'Hermès demande d'arrêter le service avant l'import.
    "${en_tant_que_hermes[@]}" "$bin_hermes" gateway stop || true
    if "${en_tant_que_hermes[@]}" "$bin_hermes" import --force "$dossier_import/hermes.zip"; then
      info "Données d'Hermès restaurées."
    else
      info "ATTENTION : l'import d'Hermès a échoué (message ci-dessus). Relance cette restauration."
    fi
    "${en_tant_que_hermes[@]}" "$bin_hermes" gateway start || info "Relance Hermès : sudo bash $DOSSIER_DEPLOY/scripts/installer-hermes.sh"
  fi
fi

cat <<EOF

==============================================================
 Restauration terminée. Vérifie (guide, étape 8) :
   docker compose ps   (dans $DOSSIER_DEPLOY)
   le cockpit et n8n dans ton navigateur.
==============================================================
EOF
