#!/usr/bin/env bash
# Sauvegarde du cockpit J-Square : volumes Docker de n8n et de Caddy, deploy/.env et données d'Hermès.
# Lancée chaque nuit à 03:30 (heure de Paris) par /etc/cron.d/jsquare-sauvegarde (installer-vps.sh).
# À la main :  sudo bash /opt/jsquare/deploy/scripts/sauvegarde.sh
# Résultat : /var/backups/jsquare/jsquare-AAAA-MM-JJ_HHMMSS.tar.gz (lisible par root seulement).
# Les archives de plus de 14 jours sont effacées. État : /var/backups/jsquare/derniere-sauvegarde.txt
# Restauration : scripts/restaurer.sh. La base Supabase est sauvegardée par Supabase (offre Pro).
set -euo pipefail

DOSSIER_SAUVEGARDES="${DOSSIER_SAUVEGARDES:-/var/backups/jsquare}"
JOURS_GARDES="${JOURS_GARDES:-14}"
UTILISATEUR_HERMES="${UTILISATEUR_HERMES:-hermes}"
PROJET="jsquare"                                # nom du projet docker compose
VOLUMES=(jsquare_n8n_data jsquare_caddy_data)   # noms fixés dans docker-compose.yml

DOSSIER_DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

journal() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
erreur() {
  journal "ERREUR : $*" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || erreur "lance ce script avec sudo : sudo bash $0"
command -v docker >/dev/null || erreur "Docker n'est pas installé (lance d'abord installer-vps.sh)"
[[ "$JOURS_GARDES" =~ ^[0-9]+$ ]] || erreur "JOURS_GARDES doit être un nombre de jours"

horodatage="$(date '+%Y-%m-%d_%H%M%S')"
nom="jsquare-$horodatage.tar.gz"
install -d -m 700 "$DOSSIER_SAUVEGARDES"
travail="$(mktemp -d "$DOSSIER_SAUVEGARDES/.en-cours-XXXXXX")"
partiel="$DOSSIER_SAUVEGARDES/.$nom.partiel"
dossier_hermes_tmp=""
n8n_arrete=""
alertes=()

# Quoi qu'il arrive : n8n redémarre et les fichiers temporaires disparaissent.
nettoyer() {
  if [[ -n "$n8n_arrete" ]]; then
    docker start "$n8n_arrete" >/dev/null || journal "ATTENTION : n8n n'a pas redémarré (docker compose up -d)"
  fi
  rm -rf "$travail" "$partiel"
  if [[ -n "$dossier_hermes_tmp" ]]; then rm -rf "$dossier_hermes_tmp"; fi
}
trap nettoyer EXIT

journal "Début de la sauvegarde ($nom)"

# ─── 1. Volumes Docker ──────────────────────────────────────────────────────
# n8n est arrêté le temps de la copie (quelques secondes) : sa base SQLite reste cohérente.
# Stripe renvoie tout seul les événements reçus pendant ce temps.
conteneur_n8n="$(docker ps -q --filter "label=com.docker.compose.project=$PROJET" \
  --filter "label=com.docker.compose.service=n8n")"
if [[ -n "$conteneur_n8n" ]]; then
  journal "Arrêt de n8n le temps de la copie"
  docker stop -t 60 "$conteneur_n8n" >/dev/null
  n8n_arrete="$conteneur_n8n"
fi
for volume in "${VOLUMES[@]}"; do
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then
    journal "Volume $volume absent (pas encore créé) : ignoré"
    continue
  fi
  point="$(docker volume inspect -f '{{ .Mountpoint }}' "$volume")"
  [[ -d "$point" ]] || erreur "dossier du volume $volume introuvable : $point"
  tar --numeric-owner -cf "$travail/$volume.tar" -C "$point" .
  journal "Volume $volume copié"
done
if [[ -n "$n8n_arrete" ]]; then
  docker start "$n8n_arrete" >/dev/null
  n8n_arrete=""
  journal "n8n redémarré"
fi

# ─── 2. Réglages du serveur (secrets) ───────────────────────────────────────
if [[ -f "$DOSSIER_DEPLOY/.env" ]]; then
  install -m 600 "$DOSSIER_DEPLOY/.env" "$travail/deploy.env"
  journal "deploy/.env copié"
else
  alertes+=("deploy/.env absent")
fi

# ─── 3. Hermès (commande officielle « hermes backup », sûre même s'il tourne) ──
if id "$UTILISATEUR_HERMES" >/dev/null 2>&1; then
  maison="$(getent passwd "$UTILISATEUR_HERMES" | cut -d: -f6)"
  bin_hermes="${HERMES_BIN:-$maison/.local/bin/hermes}"
  if [[ -x "$bin_hermes" ]]; then
    dossier_hermes_tmp="$(mktemp -d /tmp/jsquare-hermes-XXXXXX)"
    chown "$UTILISATEUR_HERMES" "$dossier_hermes_tmp"
    if runuser -u "$UTILISATEUR_HERMES" -- env HOME="$maison" \
      PATH="$maison/.local/bin:/usr/local/bin:/usr/bin:/bin" \
      "$bin_hermes" backup -o "$dossier_hermes_tmp/hermes.zip" >/dev/null; then
      journal "Hermès sauvegardé"
    else
      alertes+=("hermes backup incomplet (voir journalctl --user -u hermes-gateway)")
    fi
    if [[ -s "$dossier_hermes_tmp/hermes.zip" ]]; then
      install -m 600 "$dossier_hermes_tmp/hermes.zip" "$travail/hermes.zip"
    else
      alertes+=("pas d'archive Hermès")
    fi
  else
    journal "Hermès pas encore installé : ignoré"
  fi
fi

# ─── 4. Archive finale ──────────────────────────────────────────────────────
cat >"$travail/LISEZMOI.txt" <<EOF
Sauvegarde du cockpit J-Square du $(date '+%d/%m/%Y à %H:%M') (serveur $(uname -n)).
- jsquare_n8n_data.tar  : données de n8n (workflows, identifiants chiffrés, exécutions)
- jsquare_caddy_data.tar : certificats HTTPS
- deploy.env            : réglages du serveur (SECRETS : clés Supabase, n8n, Hermès)
- hermes.zip            : données d'Hermès (« hermes import »), avec ses secrets
Restaurer : sudo bash deploy/scripts/restaurer.sh <cette archive>
EOF
tar -czf "$partiel" -C "$travail" .
chmod 600 "$partiel"
mv -f "$partiel" "$DOSSIER_SAUVEGARDES/$nom"
journal "Archive prête : $DOSSIER_SAUVEGARDES/$nom ($(du -h "$DOSSIER_SAUVEGARDES/$nom" | cut -f1))"

# ─── 5. Ménage : on garde les $JOURS_GARDES derniers jours ──────────────────
find "$DOSSIER_SAUVEGARDES" -maxdepth 1 -type f -name 'jsquare-*.tar.gz' -mtime +"$JOURS_GARDES" -print -delete |
  while IFS= read -r vieux; do journal "Ancienne sauvegarde effacée : $(basename "$vieux")"; done

# ─── 6. État lisible par Jay ────────────────────────────────────────────────
{
  echo "Dernière sauvegarde : $(date '+%d/%m/%Y %H:%M')"
  echo "Archive : $DOSSIER_SAUVEGARDES/$nom"
  if ((${#alertes[@]})); then
    printf 'À regarder : %s\n' "${alertes[@]}"
  else
    echo "Tout est OK."
  fi
} >"$DOSSIER_SAUVEGARDES/derniere-sauvegarde.txt"

if ((${#alertes[@]})); then
  journal "Terminé avec des points à regarder : ${alertes[*]}"
else
  journal "Terminé : tout est OK"
fi
