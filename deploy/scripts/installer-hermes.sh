#!/usr/bin/env bash
# Installe et règle Hermès (Hermes Agent, Nous Research) sur l'hôte, pour le compte « hermes » :
# script officiel, API sur 127.0.0.1:8642 avec clé, MCP Supabase en lecture seule,
# consignes de rôle du « centre » (SOUL.md), service qui redémarre tout seul au boot.
# À lancer avec sudo, après configurer.sh :  sudo bash /opt/jsquare/deploy/scripts/installer-hermes.sh
# Relançable : ne réinstalle pas Hermès et ne redemande que ce qui manque.
set -euo pipefail

UTILISATEUR_HERMES="${UTILISATEUR_HERMES:-hermes}"
URL_INSTALLATION="https://hermes-agent.nousresearch.com/install.sh" # doc officielle, Installation
PORT_HERMES=8642
SERVICE_HERMES="hermes-gateway" # nom du service utilisateur pour ~/.hermes (doc Messaging Gateway)

DOSSIER_SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOSSIER_DEPLOY="$(cd "$DOSSIER_SCRIPTS/.." && pwd)"
MODELES="$DOSSIER_DEPLOY/hermes"

etape() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
erreur() {
  printf '\nERREUR : %s\n' "$*" >&2
  exit 1
}

valeur_dans() {
  local ligne
  ligne="$(grep -m1 -E "^$2=" "$1" 2>/dev/null || true)"
  printf '%s' "${ligne#*=}"
}

# Écrit CLE=valeur dans un fichier .env (remplace ou ajoute), droits 600.
ecrire_valeur() {
  local fichier="$1" cle="$2" valeur="$3" tmp ligne trouve=0
  tmp="$(mktemp "$fichier.XXXXXX")"
  while IFS= read -r ligne || [[ -n "$ligne" ]]; do
    if [[ "$ligne" == "$cle="* ]]; then
      if ((trouve == 0)); then printf '%s=%s\n' "$cle" "$valeur"; fi
      trouve=1
    else
      printf '%s\n' "$ligne"
    fi
  done <"$fichier" >"$tmp"
  if ((trouve == 0)); then printf '%s=%s\n' "$cle" "$valeur" >>"$tmp"; fi
  chmod 600 "$tmp"
  mv -f "$tmp" "$fichier"
}

demander_secret() {
  local reponse
  read -r -s -p "    $1 : " reponse || true
  printf '\n' >&2
  printf '%s' "$reponse"
}

demander() {
  local reponse
  read -r -p "    $1 : " reponse || true
  printf '%s' "$reponse"
}

# ─── Partie lancée par root ─────────────────────────────────────────────────
partie_root() {
  [[ $EUID -eq 0 ]] || erreur "lance ce script avec sudo : sudo bash $0"
  id "$UTILISATEUR_HERMES" >/dev/null 2>&1 || erreur "le compte $UTILISATEUR_HERMES n'existe pas : lance d'abord installer-vps.sh"
  local env_deploy="$DOSSIER_DEPLOY/.env" cle maison uid
  [[ -f "$env_deploy" ]] || erreur "deploy/.env manque : lance d'abord configurer.sh"
  cle="$(valeur_dans "$env_deploy" HERMES_API_KEY)"
  if [[ -z "$cle" || "$cle" == "$(valeur_dans "$DOSSIER_DEPLOY/.env.example" HERMES_API_KEY)" ]]; then
    erreur "HERMES_API_KEY manque dans deploy/.env : lance d'abord configurer.sh"
  fi
  maison="$(getent passwd "$UTILISATEUR_HERMES" | cut -d: -f6)"
  uid="$(id -u "$UTILISATEUR_HERMES")"

  etape "Session de service du compte $UTILISATEUR_HERMES (démarre au boot)"
  loginctl enable-linger "$UTILISATEUR_HERMES"
  systemctl start "user@$uid.service"
  local i
  for i in $(seq 1 30); do
    [[ -S "/run/user/$uid/bus" ]] && break
    sleep 1
  done
  [[ -S "/run/user/$uid/bus" ]] || erreur "la session systemd de $UTILISATEUR_HERMES ne démarre pas (essaie : sudo reboot, puis relance)"
  info "OK (après ${i}s)"

  # Les secrets passent par l'environnement, jamais par la ligne de commande (visible avec ps).
  export JSQ_API_SERVER_KEY="$cle"
  JSQ_SUPABASE_URL="$(valeur_dans "$env_deploy" SUPABASE_URL)"
  JSQ_MODELE="$(valeur_dans "$env_deploy" HERMES_MODEL)"
  export JSQ_SUPABASE_URL JSQ_MODELE
  runuser -u "$UTILISATEUR_HERMES" -- env \
    HOME="$maison" USER="$UTILISATEUR_HERMES" LOGNAME="$UTILISATEUR_HERMES" \
    XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" \
    PATH="$maison/.local/bin:/usr/local/bin:/usr/bin:/bin" \
    bash "$DOSSIER_SCRIPTS/installer-hermes.sh" --partie-hermes
  unset JSQ_API_SERVER_KEY

  etape "Contrôle : l'API Hermès n'est pas exposée"
  local ip_relais adresses mauvaises=()
  ip_relais="$(valeur_dans "$env_deploy" HERMES_RELAIS_IP)"
  mapfile -t adresses < <(ss -H -ltn "sport = :$PORT_HERMES" | awk '{print $4}')
  for a in "${adresses[@]}"; do
    case "$a" in
      "127.0.0.1:$PORT_HERMES" | "${ip_relais:-172.17.0.1}:$PORT_HERMES") ;;
      *) mauvaises+=("$a") ;;
    esac
  done
  if ((${#mauvaises[@]})); then
    erreur "le port $PORT_HERMES écoute sur ${mauvaises[*]} : il ne doit écouter que sur 127.0.0.1. Vérifie API_SERVER_HOST dans $maison/.hermes/.env"
  fi
  info "Écoute : ${adresses[*]:-aucune} (127.0.0.1 = Hermès, ${ip_relais:-172.17.0.1} = relais Docker)"

  etape "Contrôle : le cockpit joint Hermès (conteneur -> relais -> Hermès)"
  local compose=(docker compose --project-directory "$DOSSIER_DEPLOY")
  if "${compose[@]}" ps --status running --services 2>/dev/null | grep -qx cockpit; then
    if "${compose[@]}" exec -T cockpit node -e \
      "fetch('http://host.docker.internal:$PORT_HERMES/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
      info "OK : le cockpit joint Hermès."
    else
      info "Le cockpit ne joint pas Hermès. Voir « Si ça ne marche pas » dans deploy/README.md (relais, pare-feu)."
    fi
  else
    info "Le cockpit ne tourne pas encore : lance  cd $DOSSIER_DEPLOY && docker compose up -d  puis relance ce script."
  fi
  cat <<EOF

==============================================================
 Hermès est prêt.
 Les conteneurs le joignent par le relais : relance-le si besoin avec
   cd $DOSSIER_DEPLOY && docker compose up -d
 Clé à coller dans n8n (identifiant « Hermès API ») : la valeur de
 HERMES_API_KEY, que tu affiches avec :  grep HERMES_API_KEY $DOSSIER_DEPLOY/.env
==============================================================
EOF
}

# Lit la réponse JSON de GET /v1/toolsets sur l'entrée standard et écrit les outils
# dangereux encore actifs (terminal, fichiers, code, web, navigateur…). Code 1 si illisible.
outils_dangereux() {
  python3 -c '
import json, sys
INTERDITS = {"terminal", "process_manage", "read_file", "write_file", "patch", "search_files", "execute_code",
             "web_search", "web_extract", "delegate_task", "cronjob_manage", "computer_use", "manage_connections",
             "skill_manage"}
try:
    donnees = json.load(sys.stdin)
except ValueError:
    sys.exit(1)
liste = donnees.get("data", donnees.get("toolsets")) if isinstance(donnees, dict) else donnees
if not isinstance(liste, list):
    sys.exit(1)
trouves = set()
for t in liste:
    if isinstance(t, dict) and t.get("enabled"):
        for outil in t.get("tools") or []:
            if outil in INTERDITS or str(outil).startswith("browser_"):
                trouves.add(outil)
print(" ".join(sorted(trouves)))
'
}

# ─── Partie lancée en tant que « hermes » ───────────────────────────────────
fusionner_config() {
  local dest="$1" modele="$2"
  python3 - "$dest" "$modele" <<'PY'
import os, sys
import yaml

dest, modele = sys.argv[1], sys.argv[2]
try:
    with open(dest, encoding="utf-8") as f:
        actuel = yaml.safe_load(f) or {}
except FileNotFoundError:
    actuel = {}
with open(modele, encoding="utf-8") as f:
    ajout = yaml.safe_load(f) or {}
if not isinstance(actuel, dict):
    sys.exit("config.yaml actuel illisible (pas un dictionnaire)")

# Le modèle choisi avec « hermes model » est gardé s'il existe déjà.
if actuel.get("model"):
    ajout.pop("model", None)

# Les listes d'outils par canal (platform_toolsets) sont REMPLACÉES, jamais complétées :
# garder un ancien « hermes-api-server » rendrait le terminal à l'API.
def fusion(a, b, chemin=()):
    for k, v in b.items():
        ici = chemin + (k,)
        if isinstance(v, dict) and isinstance(a.get(k), dict):
            fusion(a[k], v, ici)
        elif isinstance(v, list) and isinstance(a.get(k), list) and ici[0] != "platform_toolsets":
            a[k] = a[k] + [x for x in v if x not in a[k]]
        else:
            a[k] = v
    return a

resultat = fusion(actuel, ajout)
tmp = dest + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    f.write("# Complété avec deploy/hermes/config.yaml par installer-hermes.sh (J-Square)\n")
    yaml.safe_dump(resultat, f, allow_unicode=True, sort_keys=False, default_flow_style=False)
os.chmod(tmp, 0o600)
os.replace(tmp, dest)
PY
}

partie_hermes() {
  [[ "$(id -un)" == "$UTILISATEUR_HERMES" ]] || erreur "cette partie tourne avec le compte $UTILISATEUR_HERMES"
  [[ -n "${JSQ_API_SERVER_KEY:-}" ]] || erreur "clé de l'API absente (lance le script avec sudo, sans option)"
  cd "$HOME"
  local bin="${HERMES_BIN:-$HOME/.local/bin/hermes}"
  local dossier="${HERMES_HOME:-$HOME/.hermes}"
  local secrets="$dossier/.env"

  etape "Installation d'Hermès (script officiel, sans navigateur ni pilotage d'écran)"
  if [[ -x "$bin" ]]; then
    info "Déjà installé : $bin (mise à jour plus tard : hermes update)"
  else
    curl -fsSL "$URL_INSTALLATION" | bash -s -- --skip-browser --skip-computer-use --non-interactive
    [[ -x "$bin" ]] || erreur "l'installation d'Hermès n'a pas abouti (message ci-dessus)"
  fi

  etape "Secrets d'Hermès ($secrets)"
  install -d -m 700 "$dossier"
  [[ -f "$secrets" ]] || install -m 600 /dev/null "$secrets"
  chmod 600 "$secrets"
  # API : boucle locale seulement, avec la même clé que HERMES_API_KEY du cockpit.
  ecrire_valeur "$secrets" API_SERVER_ENABLED true
  ecrire_valeur "$secrets" API_SERVER_HOST 127.0.0.1
  ecrire_valeur "$secrets" API_SERVER_PORT "$PORT_HERMES"
  ecrire_valeur "$secrets" API_SERVER_KEY "$JSQ_API_SERVER_KEY"
  # Nom annoncé par l'API : le même que HERMES_MODEL du cockpit (hermes-agent par défaut).
  ecrire_valeur "$secrets" API_SERVER_MODEL_NAME "${JSQ_MODELE:-hermes-agent}"

  local valeur
  if [[ -z "$(valeur_dans "$secrets" ANTHROPIC_API_KEY)" ]]; then
    info "Clé API Claude : console.anthropic.com > API Keys > Create Key (pose aussi un plafond de dépense)."
    valeur="$(demander_secret "Clé Anthropic (sk-ant-…, ne s'affiche pas)")"
    [[ -n "$valeur" ]] || erreur "sans clé Anthropic, Hermès ne peut pas répondre. Relance le script quand tu l'as."
    [[ "$valeur" == sk-ant-* ]] || info "Attention : la clé ne commence pas par sk-ant-."
    ecrire_valeur "$secrets" ANTHROPIC_API_KEY "$valeur"
  fi
  if [[ -z "$(valeur_dans "$secrets" SUPABASE_PROJECT_REF)" ]]; then
    if [[ "${JSQ_SUPABASE_URL:-}" =~ ^https://([a-z0-9]+)\.supabase\.co/?$ ]]; then
      valeur="${BASH_REMATCH[1]}"
      info "Référence du projet Supabase lue dans deploy/.env : $valeur"
    else
      valeur="$(demander "Référence du projet Supabase (le « abcd… » de https://abcd….supabase.co)")"
    fi
    if [[ -n "$valeur" ]]; then ecrire_valeur "$secrets" SUPABASE_PROJECT_REF "$valeur"; fi
  fi
  if [[ -z "$(valeur_dans "$secrets" SUPABASE_ACCESS_TOKEN)" ]]; then
    info "Jeton Supabase pour la lecture (supabase.com > Account > Access Tokens, limité au projet)."
    info "Entrée pour plus tard : Hermès marchera, mais sans lire Supabase."
    valeur="$(demander_secret "Jeton Supabase (sbp_…, ne s'affiche pas)")"
    if [[ -n "$valeur" ]]; then
      [[ "$valeur" == sbp_* ]] || info "Attention : le jeton ne commence pas par sbp_."
      ecrire_valeur "$secrets" SUPABASE_ACCESS_TOKEN "$valeur"
    fi
  fi

  etape "Configuration ($dossier/config.yaml)"
  if python3 -c 'import yaml' 2>/dev/null; then
    fusionner_config "$dossier/config.yaml" "$MODELES/config.yaml"
    info "Modèle, fuseau Europe/Paris, garde-fous et MCP Supabase (lecture seule) en place."
  elif [[ ! -f "$dossier/config.yaml" ]]; then
    install -m 600 "$MODELES/config.yaml" "$dossier/config.yaml"
    info "Copiée depuis deploy/hermes/config.yaml."
  else
    info "python3-yaml manque : recopie à la main les blocs de $MODELES/config.yaml dans $dossier/config.yaml"
  fi

  etape "Consignes de rôle du centre ($dossier/SOUL.md)"
  if [[ -f "$dossier/SOUL.md" ]] && grep -q 'jsquare-centre' "$dossier/SOUL.md"; then
    if cmp -s "$dossier/SOUL.md" "$MODELES/SOUL.md"; then
      info "Déjà en place."
    else
      info "Ta version modifiée est gardée. Modèle à jour : $MODELES/SOUL.md"
    fi
  else
    if [[ -f "$dossier/SOUL.md" ]]; then
      cp -p "$dossier/SOUL.md" "$dossier/SOUL.md.avant-jsquare"
      info "Ancien SOUL.md gardé dans SOUL.md.avant-jsquare"
    fi
    install -m 600 "$MODELES/SOUL.md" "$dossier/SOUL.md"
    info "Installées."
  fi

  etape "Service Hermès (API sur 127.0.0.1:$PORT_HERMES)"
  if systemctl --user cat "$SERVICE_HERMES" >/dev/null 2>&1; then
    "$bin" gateway restart
  else
    info "Si une question s'affiche (démarrer maintenant ?), réponds oui."
    "$bin" gateway install
    "$bin" gateway start || true
  fi

  etape "Test de l'API"
  local ok=0 code
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$PORT_HERMES/health" 2>/dev/null; then
      ok=1
      break
    fi
    sleep 2
  done
  ((ok)) || erreur "l'API ne répond pas sur 127.0.0.1:$PORT_HERMES. Regarde : journalctl --user -u $SERVICE_HERMES -n 50"
  # La clé passe par l'entrée standard de curl, pas par la ligne de commande.
  local reponse
  reponse="$(printf 'header = "Authorization: Bearer %s"\n' "$JSQ_API_SERVER_KEY" |
    curl -sS -w '\n%{http_code}' --config - "http://127.0.0.1:$PORT_HERMES/v1/models" || true)"
  code="${reponse##*$'\n'}"
  [[ "$code" == 200 ]] || erreur "l'API refuse la clé (code $code). Vérifie API_SERVER_KEY dans $secrets"
  info "L'API répond et accepte la clé."
  if [[ "$reponse" != *"\"${JSQ_MODELE:-hermes-agent}\""* ]]; then
    info "Attention : Hermès ne s'annonce pas sous le nom ${JSQ_MODELE:-hermes-agent} (voir API_SERVER_MODEL_NAME)."
  fi

  etape "Outils de l'API (ni terminal, ni fichiers, ni code, ni web)"
  reponse="$(printf 'header = "Authorization: Bearer %s"\n' "$JSQ_API_SERVER_KEY" |
    curl -sS --config - "http://127.0.0.1:$PORT_HERMES/v1/toolsets" || true)"
  local dangereux
  dangereux="$(printf '%s' "$reponse" | outils_dangereux)" || erreur "liste des outils illisible (GET /v1/toolsets). Regarde : journalctl --user -u $SERVICE_HERMES -n 50"
  if [[ -n "$dangereux" ]]; then
    "$bin" gateway stop || true
    erreur "Hermès a encore des outils dangereux sur l'API : $dangereux. Service arrêté. Vérifie platform_toolsets dans $dossier/config.yaml"
  fi
  info "L'API n'a que la base en lecture seule (MCP Supabase) et sa mémoire."
}

case "${1:-}" in
  --partie-hermes) partie_hermes ;;
  "") partie_root ;;
  -h | --help) sed -n '2,6p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
  *) erreur "option inconnue : $1" ;;
esac
