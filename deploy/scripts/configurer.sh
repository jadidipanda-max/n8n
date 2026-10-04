#!/usr/bin/env bash
# Crée ou complète deploy/.env : clés générées, domaine, compte propriétaire n8n, clés Supabase.
# À lancer avec ton compte (jay), sans sudo :  bash /opt/jsquare/deploy/scripts/configurer.sh
# Relançable : il ne redemande que ce qui manque.
# Options : --mot-de-passe-n8n (changer le mot de passe n8n), --supabase (ressaisir les clés Supabase).
set -euo pipefail

DOSSIER_DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FICHIER_ENV="$DOSSIER_DEPLOY/.env"
MODELE_ENV="$DOSSIER_DEPLOY/.env.example"
FICHIER_COMPOSE="$DOSSIER_DEPLOY/docker-compose.yml"

CHANGER_MDP_N8N=0
RESAISIR_SUPABASE=0
for arg in "$@"; do
  case "$arg" in
    --mot-de-passe-n8n) CHANGER_MDP_N8N=1 ;;
    --supabase) RESAISIR_SUPABASE=1 ;;
    -h | --help)
      sed -n '2,6p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Option inconnue : $arg" >&2
      exit 2
      ;;
  esac
done

etape() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
erreur() {
  printf '\nERREUR : %s\n' "$*" >&2
  exit 1
}

# Valeur d'une clé dans un fichier .env (vide si absente).
valeur_dans() {
  local ligne
  ligne="$(grep -m1 -E "^$2=" "$1" 2>/dev/null || true)"
  printf '%s' "${ligne#*=}"
}

# Vrai si la clé est vide ou encore à sa valeur factice du modèle.
a_remplir() {
  local actuelle
  actuelle="$(valeur_dans "$FICHIER_ENV" "$1")"
  [[ -z "$actuelle" || "$actuelle" == "$(valeur_dans "$MODELE_ENV" "$1")" ]]
}

# Écrit CLE=valeur dans .env (remplace la ligne ou l'ajoute), sans interpréter la valeur.
ecrire_valeur() {
  local cle="$1" valeur="$2" tmp ligne trouve=0
  tmp="$(mktemp "$FICHIER_ENV.XXXXXX")"
  while IFS= read -r ligne || [[ -n "$ligne" ]]; do
    if [[ "$ligne" == "$cle="* ]]; then
      if ((trouve == 0)); then printf '%s=%s\n' "$cle" "$valeur"; fi
      trouve=1
    else
      printf '%s\n' "$ligne"
    fi
  done <"$FICHIER_ENV" >"$tmp"
  if ((trouve == 0)); then printf '%s=%s\n' "$cle" "$valeur" >>"$tmp"; fi
  chmod 600 "$tmp"
  mv -f "$tmp" "$FICHIER_ENV"
}

# Pose une question ; « $2 » est la réponse par défaut (Entrée).
demander() {
  local question="$1" defaut="${2:-}" reponse
  if [[ -n "$defaut" ]]; then question="$question [$defaut]"; fi
  read -r -p "    $question : " reponse || true
  printf '%s' "${reponse:-$defaut}"
}

# Question sans affichage de la réponse (mots de passe, clés).
demander_secret() {
  local reponse
  read -r -s -p "    $1 : " reponse || true
  printf '\n' >&2
  printf '%s' "$reponse"
}

cle_aleatoire() { openssl rand -hex 32; }

# Empreinte bcrypt (coût 10, comme n8n) calculée par Caddy ; le mot de passe passe par l'entrée standard.
hacher_mot_de_passe() {
  if [[ -n "${CADDY_BIN:-}" ]]; then
    printf '%s\n' "$1" | "$CADDY_BIN" hash-password --algorithm bcrypt --bcrypt-cost 10
    return
  fi
  local image
  image="$(grep -m1 -oE 'caddy:[0-9][0-9.]*-alpine' "$FICHIER_COMPOSE")" || erreur "image Caddy introuvable dans docker-compose.yml"
  docker info >/dev/null 2>&1 || erreur "Docker n'est pas accessible avec ton compte. Déconnecte-toi (exit), reconnecte-toi, puis relance ce script."
  printf '%s\n' "$1" | docker run --rm -i "$image" caddy hash-password --algorithm bcrypt --bcrypt-cost 10
}

# Règles de n8n pour un mot de passe : 8 à 64 caractères, au moins un chiffre et une majuscule.
mot_de_passe_valide() {
  local m="$1"
  ((${#m} >= 8 && ${#m} <= 64)) && [[ "$m" =~ [0-9] && "$m" =~ [A-Z] ]]
}

# ─── Vérifications ──────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] || erreur "lance ce script avec ton compte (jay), sans sudo : bash $0"
[[ -f "$MODELE_ENV" ]] || erreur "modèle introuvable : $MODELE_ENV"
command -v openssl >/dev/null || erreur "openssl manque (lance d'abord scripts/installer-vps.sh)"

etape "Fichier de réglages $FICHIER_ENV"
if [[ -f "$FICHIER_ENV" ]]; then
  chmod 600 "$FICHIER_ENV"
  info "Il existe déjà : je complète seulement ce qui manque."
else
  install -m 600 "$MODELE_ENV" "$FICHIER_ENV"
  info "Créé à partir du modèle (lisible par toi seul)."
fi

# ─── Domaine et e-mail ──────────────────────────────────────────────────────
etape "Domaine"
if a_remplir DOMAINE; then
  while true; do
    domaine="$(demander "Ton nom de domaine, sans https ni www (ex. jsquare.fr)")"
    domaine="${domaine,,}"
    domaine="${domaine#http://}"
    domaine="${domaine#https://}"
    domaine="${domaine#www.}"
    domaine="${domaine%%/*}"
    if [[ "$domaine" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then break; fi
    info "Ce n'est pas un nom de domaine valable. Exemple : jsquare.fr"
  done
  ecrire_valeur DOMAINE "$domaine"
fi
domaine="$(valeur_dans "$FICHIER_ENV" DOMAINE)"
info "Cockpit : https://cockpit.$domaine   n8n : https://n8n.$domaine"

if a_remplir EMAIL_ACME; then
  while true; do
    email="$(demander "Ton e-mail (pour les certificats HTTPS)")"
    if [[ "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then break; fi
    info "Ce n'est pas une adresse e-mail valable."
  done
  ecrire_valeur EMAIL_ACME "$email"
fi

# ─── Clés générées ──────────────────────────────────────────────────────────
etape "Clés secrètes"
if a_remplir N8N_ENCRYPTION_KEY; then
  ecrire_valeur N8N_ENCRYPTION_KEY "$(cle_aleatoire)"
  info "Clé de chiffrement n8n générée. Recopie-la dans ton gestionnaire de mots de passe :"
  info "  grep N8N_ENCRYPTION_KEY $FICHIER_ENV"
else
  info "Clé de chiffrement n8n : déjà là (on n'y touche jamais)."
fi
if a_remplir HERMES_API_KEY; then
  ecrire_valeur HERMES_API_KEY "$(cle_aleatoire)"
  info "Clé de l'API Hermès générée."
else
  info "Clé de l'API Hermès : déjà là."
fi

# Adresse du pont Docker (host-gateway) : là où écoute le relais vers Hermès.
ip_pont="$(ip -4 -o addr show dev docker0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n1 || true)"
if [[ -n "$ip_pont" && "$ip_pont" != "$(valeur_dans "$FICHIER_ENV" HERMES_RELAIS_IP)" ]]; then
  ecrire_valeur HERMES_RELAIS_IP "$ip_pont"
  info "Adresse du pont Docker : $ip_pont"
fi

# ─── Supabase ───────────────────────────────────────────────────────────────
etape "Supabase (étape 3 du guide)"
if a_remplir SUPABASE_URL || ((RESAISIR_SUPABASE)); then
  info "Supabase > Project Settings > Data API > Project URL (ex. https://abcdefghijklmnop.supabase.co)."
  info "Appuie sur Entrée pour le faire plus tard : le cockpit restera en mode démo."
  url="$(demander "Adresse du projet Supabase")"
  url="${url%/}"
  if [[ -z "$url" ]]; then
    ecrire_valeur SUPABASE_URL ""
    ecrire_valeur SUPABASE_PUBLISHABLE_KEY ""
    ecrire_valeur SUPABASE_SECRET_KEY ""
    info "Supabase laissé vide : mode démo. Relance ce script quand tu as les clés."
  else
    [[ "$url" =~ ^https://[a-z0-9]+\.supabase\.co$ ]] || info "Attention : l'adresse ne ressemble pas à https://<ref>.supabase.co. Je la garde quand même."
    ecrire_valeur SUPABASE_URL "$url"
    RESAISIR_SUPABASE=1
  fi
fi
if [[ -n "$(valeur_dans "$FICHIER_ENV" SUPABASE_URL)" ]]; then
  if a_remplir SUPABASE_PUBLISHABLE_KEY || ((RESAISIR_SUPABASE)); then
    cle="$(demander "Clé publishable (sb_publishable_…)")"
    [[ "$cle" == sb_publishable_* ]] || info "Attention : la clé ne commence pas par sb_publishable_."
    ecrire_valeur SUPABASE_PUBLISHABLE_KEY "$cle"
  fi
  if a_remplir SUPABASE_SECRET_KEY || ((RESAISIR_SUPABASE)); then
    info "Clé secrète réservée au cockpit (Project Settings > API Keys > Secret keys, nom « cockpit »)."
    cle="$(demander_secret "Clé secrète (sb_secret_…, ne s'affiche pas)")"
    [[ "$cle" == sb_secret_* ]] || info "Attention : la clé ne commence pas par sb_secret_."
    ecrire_valeur SUPABASE_SECRET_KEY "$cle"
  fi
fi

# ─── Compte propriétaire n8n ────────────────────────────────────────────────
etape "Compte propriétaire de n8n"
if [[ -z "$(valeur_dans "$FICHIER_ENV" N8N_INSTANCE_OWNER_PASSWORD_HASH)" ]] || ((CHANGER_MDP_N8N)); then
  email_defaut="$(valeur_dans "$FICHIER_ENV" N8N_INSTANCE_OWNER_EMAIL)"
  if a_remplir N8N_INSTANCE_OWNER_EMAIL; then email_defaut="$(valeur_dans "$FICHIER_ENV" EMAIL_ACME)"; fi
  while true; do
    email_n8n="$(demander "E-mail de connexion à n8n" "$email_defaut")"
    if [[ "$email_n8n" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then break; fi
    info "Ce n'est pas une adresse e-mail valable."
  done
  info "Mot de passe n8n : 8 caractères au moins, avec au moins un chiffre et une majuscule."
  while true; do
    mdp="$(demander_secret "Mot de passe n8n (ne s'affiche pas)")"
    if ! mot_de_passe_valide "$mdp"; then
      info "Trop simple : 8 à 64 caractères, au moins un chiffre et une majuscule."
      continue
    fi
    mdp2="$(demander_secret "Retape-le")"
    if [[ "$mdp" == "$mdp2" ]]; then break; fi
    info "Les deux mots de passe sont différents. Recommence."
  done
  info "Calcul de l'empreinte du mot de passe (quelques secondes)…"
  empreinte="$(hacher_mot_de_passe "$mdp" | tail -n1)"
  unset mdp mdp2
  [[ "$empreinte" =~ ^\$2[aby]\$10\$ ]] || erreur "l'empreinte du mot de passe n'a pas pu être calculée."
  ecrire_valeur N8N_INSTANCE_OWNER_EMAIL "$email_n8n"
  # Entre apostrophes : docker compose ne doit pas lire les « $ » de l'empreinte.
  ecrire_valeur N8N_INSTANCE_OWNER_PASSWORD_HASH "'$empreinte'"
  ecrire_valeur N8N_INSTANCE_OWNER_MANAGED_BY_ENV true
  info "Compte n8n prêt : $email_n8n (le mot de passe n'est pas enregistré, seulement son empreinte)."
else
  info "Déjà prêt : $(valeur_dans "$FICHIER_ENV" N8N_INSTANCE_OWNER_EMAIL). Pour changer le mot de passe : $0 --mot-de-passe-n8n"
fi

# ─── Contrôle final ─────────────────────────────────────────────────────────
etape "Contrôle"
if command -v docker >/dev/null 2>&1; then
  if docker compose --project-directory "$DOSSIER_DEPLOY" -f "$FICHIER_COMPOSE" --env-file "$FICHIER_ENV" config -q; then
    info "docker-compose.yml et .env sont cohérents."
  else
    erreur "docker compose refuse la configuration (message ci-dessus)."
  fi
fi
manque=()
for cle in SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY; do
  if a_remplir "$cle"; then manque+=("$cle"); fi
done
if ((${#manque[@]})); then
  info "Encore vide : ${manque[*]} -> le cockpit sera en mode démo."
fi
printf '\nC'"'"'est prêt. Prochaine commande (dans %s) :\n    docker compose up -d\n' "$DOSSIER_DEPLOY"
