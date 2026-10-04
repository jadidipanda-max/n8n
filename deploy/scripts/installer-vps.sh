#!/usr/bin/env bash
# Prépare un VPS Ubuntu 24.04 neuf pour le cockpit J-Square (contrat technique, section 5) :
# mises à jour, fuseau Europe/Paris, comptes « jay » (admin) et « hermes » (sans droits),
# Docker officiel, pare-feu ufw (22, 80, 443), fail2ban, sauvegarde quotidienne.
# À lancer avec sudo :  sudo bash /opt/jsquare/deploy/scripts/installer-vps.sh
# Relançable sans risque : chaque étape regarde d'abord ce qui est déjà fait.
set -euo pipefail

UTILISATEUR="${UTILISATEUR:-jay}"                  # compte d'administration de Jay
UTILISATEUR_HERMES="${UTILISATEUR_HERMES:-hermes}" # compte sans droits qui fera tourner Hermès
FUSEAU="Europe/Paris"
RESEAU_DOCKER="172.30.10.0/24" # même plage que le réseau « jsquare » de docker-compose.yml
PORT_HERMES=8642
DOSSIER_SAUVEGARDES="/var/backups/jsquare"
HEURE_SAUVEGARDE="30 3" # tous les jours à 03:30, heure de Paris

DOSSIER_SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOSSIER_PROJET="$(cd "$DOSSIER_SCRIPTS/../.." && pwd)"
export DEBIAN_FRONTEND=noninteractive

etape() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
erreur() {
  printf '\nERREUR : %s\n' "$*" >&2
  exit 1
}

verifier_prealables() {
  [[ $EUID -eq 0 ]] || erreur "lance ce script avec sudo : sudo bash $0"
  [[ -r /etc/os-release ]] || erreur "système inconnu (pas de /etc/os-release)"
  local id version
  id="$(. /etc/os-release && echo "${ID:-}")"
  version="$(. /etc/os-release && echo "${VERSION_ID:-}")"
  [[ "$id" == ubuntu ]] || erreur "ce script est prévu pour Ubuntu 24.04 (trouvé : $id $version)"
  [[ "$version" == 24.04 ]] || info "Attention : prévu pour Ubuntu 24.04, trouvé $version. On continue."
}

mettre_a_jour() {
  etape "Mises à jour du système (quelques minutes)"
  apt-get update -q
  apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
  apt-get -y -q install ca-certificates curl git openssl tar zip unzip cron ufw fail2ban \
    unattended-upgrades build-essential python3-yaml iproute2
  # Mises à jour de sécurité automatiques, chaque jour.
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
  info "Système à jour, mises à jour de sécurité automatiques activées."
  if [[ -f /var/run/reboot-required ]]; then
    info "Un redémarrage est conseillé (noyau mis à jour) : sudo reboot, à la fin du guide."
  fi
}

regler_fuseau() {
  etape "Fuseau horaire $FUSEAU"
  if [[ "$(timedatectl show -p Timezone --value)" != "$FUSEAU" ]]; then
    timedatectl set-timezone "$FUSEAU"
    systemctl restart cron
  fi
  timedatectl set-ntp true || true
  info "Heure du serveur : $(date '+%d/%m/%Y %H:%M %Z')"
}

creer_utilisateurs() {
  etape "Comptes « $UTILISATEUR » (administration) et « $UTILISATEUR_HERMES » (Hermès, sans droits)"
  if ! id "$UTILISATEUR" >/dev/null 2>&1; then
    adduser --disabled-password --gecos "" "$UTILISATEUR"
    info "Compte $UTILISATEUR créé."
  fi
  usermod -aG sudo "$UTILISATEUR"

  # Clés SSH : on recopie celles du compte qui a lancé le script (« ubuntu » chez OVH) si Jay n'en a pas.
  local origine="${SUDO_USER:-root}" dossier_ssh cles
  dossier_ssh="$(getent passwd "$UTILISATEUR" | cut -d: -f6)/.ssh"
  if [[ "$origine" != "$UTILISATEUR" ]]; then
    cles="$(getent passwd "$origine" | cut -d: -f6)/.ssh/authorized_keys"
    if [[ -s "$cles" && ! -s "$dossier_ssh/authorized_keys" ]]; then
      install -d -m 700 -o "$UTILISATEUR" -g "$UTILISATEUR" "$dossier_ssh"
      install -m 600 -o "$UTILISATEUR" -g "$UTILISATEUR" "$cles" "$dossier_ssh/authorized_keys"
      info "Clés SSH de $origine recopiées pour $UTILISATEUR."
    fi
  fi

  # Mot de passe de Jay (connexion SSH et sudo) : demandé une seule fois.
  if [[ "$(passwd -S "$UTILISATEUR" | awk '{print $2}')" != "P" ]]; then
    if [[ -t 0 ]]; then
      info "Choisis le mot de passe du compte $UTILISATEUR (rien ne s'affiche quand tu tapes, c'est normal) :"
      until passwd "$UTILISATEUR"; do info "Recommence."; done
    else
      info "Pas de terminal : pose le mot de passe plus tard avec  sudo passwd $UTILISATEUR"
    fi
  fi

  # Hermès : compte à part, sans sudo ni Docker. Son API donne accès au terminal de ce compte seulement.
  if ! id "$UTILISATEUR_HERMES" >/dev/null 2>&1; then
    adduser --disabled-password --gecos "" "$UTILISATEUR_HERMES"
    info "Compte $UTILISATEUR_HERMES créé."
  fi
  gpasswd -d "$UTILISATEUR_HERMES" sudo >/dev/null 2>&1 || true
  gpasswd -d "$UTILISATEUR_HERMES" docker >/dev/null 2>&1 || true
  chmod 750 "$(getent passwd "$UTILISATEUR_HERMES" | cut -d: -f6)"
  # Son service démarre au boot même sans session ouverte.
  loginctl enable-linger "$UTILISATEUR_HERMES"
}

durcir_ssh() {
  etape "SSH : connexion directe en root interdite"
  local fichier=/etc/ssh/sshd_config.d/10-jsquare.conf dossier_jay mots_de_passe
  dossier_jay="$(getent passwd "$UTILISATEUR" | cut -d: -f6)"
  mots_de_passe="$(sshd -T 2>/dev/null | awk '$1 == "passwordauthentication" {print $2}')"
  # On ne ferme root que si Jay peut entrer (clé SSH, ou mot de passe accepté par SSH).
  if [[ ! -s "$dossier_jay/.ssh/authorized_keys" && ! ("$mots_de_passe" == yes && "$(passwd -S "$UTILISATEUR" | awk '{print $2}')" == P) ]]; then
    info "Pas encore de moyen sûr pour $UTILISATEUR de se connecter : je laisse root tel quel."
    return 0
  fi
  printf '# Ajouté par installer-vps.sh (J-Square)\nPermitRootLogin no\n' >"$fichier"
  if sshd -t; then
    systemctl try-reload-or-restart ssh || true
  else
    rm -f "$fichier"
    erreur "la configuration SSH est refusée par sshd ; rien n'a été changé."
  fi
}

installer_docker() {
  etape "Docker (dépôt officiel docker.com)"
  if dpkg -s docker-ce >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    info "Déjà installé : $(docker --version)"
  else
    # Paquets non officiels qui entreraient en conflit (doc Docker, « Uninstall old versions »).
    local conflits=()
    mapfile -t conflits < <(dpkg --get-selections docker.io docker-compose docker-compose-v2 docker-doc \
      docker-buildx podman-docker containerd runc 2>/dev/null | cut -f1)
    if ((${#conflits[@]})); then apt-get -y -q remove "${conflits[@]}"; fi
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    local suite arch
    suite="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
    arch="$(dpkg --print-architecture)"
    cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $suite
Components: stable
Architectures: $arch
Signed-By: /etc/apt/keyrings/docker.asc
EOF
    apt-get update -q
    apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  # Journaux des conteneurs limités à 3 x 10 Mo (sinon ils grossissent sans fin).
  if [[ ! -f /etc/docker/daemon.json ]]; then
    install -d -m 755 /etc/docker
    printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" }\n}\n' >/etc/docker/daemon.json
    systemctl restart docker
  fi
  systemctl enable --now docker
  usermod -aG docker "$UTILISATEUR"
  info "$(docker --version) ; $(docker compose version)"
}

configurer_pare_feu() {
  etape "Pare-feu ufw : seuls 22 (SSH), 80 et 443 (HTTPS) sont ouverts"
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp comment 'SSH'
  ufw allow 80/tcp comment 'HTTP Caddy'
  ufw allow 443 comment 'HTTPS Caddy'
  # Les conteneurs (réseau jsquare) doivent joindre le relais Hermès sur le pont Docker.
  # Ce n'est pas une ouverture vers Internet : la source est le réseau interne de Docker.
  ufw allow proto tcp from "$RESEAU_DOCKER" to any port "$PORT_HERMES" comment 'conteneurs vers Hermes'
  ufw --force enable
  # Rappel : seul Caddy publie des ports (80 et 443). Un port publié par Docker passerait outre ufw.
  ufw status verbose
}

activer_fail2ban() {
  etape "fail2ban (bloque les essais répétés de mot de passe SSH)"
  systemctl enable --now fail2ban
  info "fail2ban : $(systemctl is-active fail2ban)"
}

preparer_projet() {
  etape "Dossier du projet $DOSSIER_PROJET"
  if [[ "$(stat -c %U "$DOSSIER_PROJET")" == root ]]; then
    chown -R "$UTILISATEUR:$UTILISATEUR" "$DOSSIER_PROJET"
    info "Le dossier appartient maintenant à $UTILISATEUR."
  fi
  # Le code est lu par les conteneurs (utilisateur node) : lecture pour tous, écriture pour Jay.
  chmod o+rx "$DOSSIER_PROJET" "$DOSSIER_PROJET/deploy" "$DOSSIER_PROJET/cockpit" 2>/dev/null || true
}

installer_sauvegarde() {
  etape "Sauvegarde quotidienne (03:30) dans $DOSSIER_SAUVEGARDES"
  install -d -m 700 "$DOSSIER_SAUVEGARDES"
  cat >/etc/cron.d/jsquare-sauvegarde <<EOF
# Sauvegarde quotidienne du cockpit J-Square (installée par installer-vps.sh)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
$HEURE_SAUVEGARDE * * * root bash $DOSSIER_SCRIPTS/sauvegarde.sh >>/var/log/jsquare-sauvegarde.log 2>&1
EOF
  chmod 644 /etc/cron.d/jsquare-sauvegarde
  cat >/etc/logrotate.d/jsquare-sauvegarde <<'EOF'
/var/log/jsquare-sauvegarde.log {
  monthly
  rotate 6
  compress
  missingok
  notifempty
}
EOF
  info "Programmée chaque jour à 03:30. Journal : /var/log/jsquare-sauvegarde.log"
}

resume() {
  local ip
  ip="$(hostname -I | awk '{print $1}')"
  cat <<EOF

==============================================================
 Serveur prêt.
 1. Déconnecte-toi :  exit
 2. Reconnecte-toi avec le compte $UTILISATEUR :  ssh $UTILISATEUR@$ip
 3. Puis :  bash $DOSSIER_PROJET/deploy/scripts/configurer.sh
==============================================================
EOF
}

verifier_prealables
mettre_a_jour
regler_fuseau
creer_utilisateurs
durcir_ssh
installer_docker
configurer_pare_feu
activer_fail2ban
preparer_projet
installer_sauvegarde
resume
