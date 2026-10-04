'use strict';
// Cohérence du kit de déploiement avec le contrat technique et les autres briques
// (server.js, migration Supabase, workflows n8n). Lit les vrais fichiers.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DEPLOY, RACINE, lire, lireYaml, lireEnv, binaire, dossierTemp } = require('./outils');

const contrat = lire(RACINE, 'cockpit', 'CONTRAT-TECHNIQUE.md');
const serveur = lire(RACINE, 'cockpit', 'app', 'server.js');
const exempleEnv = lire(DEPLOY, '.env.example');
const caddyfile = lire(DEPLOY, 'Caddyfile');
const installerVps = lire(DEPLOY, 'scripts', 'installer-vps.sh');
const compose = lireYaml(path.join(DEPLOY, 'docker-compose.yml'));
const sansYaml = compose === null ? 'python3-yaml absent' : false;

// Variables listées dans le contrat, section 2 (tableau « Variables d'environnement »).
const variablesContrat = (() => {
  const bloc = contrat.split('### Variables d\'environnement')[1].split('### Endpoints')[0];
  return [...bloc.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]);
})();

test('le contrat liste bien les 8 variables du serveur', () => {
  assert.deepEqual(variablesContrat.sort(), ['DEMO', 'HERMES_API_KEY', 'HERMES_MODEL', 'HERMES_URL', 'PORT',
    'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_URL']);
});

test('.env.example : toutes les variables du contrat, chacune expliquée, valeurs factices', () => {
  const valeurs = lireEnv(exempleEnv);
  const lignes = exempleEnv.split('\n');
  for (const v of variablesContrat) {
    assert.ok(v in valeurs, `${v} manque dans .env.example`);
  }
  // Chaque réglage est précédé d'au moins une ligne de commentaire.
  lignes.forEach((ligne, i) => {
    if (/^[A-Z0-9_]+=/.test(ligne)) {
      let j = i - 1;
      while (j >= 0 && /^[A-Z0-9_]+=/.test(lignes[j])) j -= 1;
      assert.match(lignes[j] || '', /^#/, `pas d'explication avant ${ligne}`);
    }
  });
  assert.equal(valeurs.HERMES_URL, 'http://host.docker.internal:8642');
  assert.equal(valeurs.HERMES_MODEL, 'hermes-agent');
  assert.equal(valeurs.PORT, '8080');
  assert.equal(valeurs.DEMO, '0');
  assert.match(valeurs.SUPABASE_PUBLISHABLE_KEY, /^sb_publishable_x+$/);
  assert.match(valeurs.SUPABASE_SECRET_KEY, /^sb_secret_x+$/);
  assert.match(valeurs.N8N_ENCRYPTION_KEY, /^a-remplacer/);
  assert.match(valeurs.HERMES_API_KEY, /^a-remplacer/);
});

test('.env n\'est jamais suivi par git', () => {
  assert.match(lire(DEPLOY, '.gitignore'), /^\.env$/m);
});

test('docker-compose.yml : services, images figées, réseau', { skip: sansYaml }, () => {
  const s = compose.services;
  assert.deepEqual(Object.keys(s).sort(), ['caddy', 'cockpit', 'n8n', 'relais-hermes']);
  assert.match(s.caddy.image, /^caddy:\d+\.\d+\.\d+-alpine$/);
  const m = /^n8nio\/n8n:(\d+)\.(\d+)\.(\d+)$/.exec(s.n8n.image);
  assert.ok(m, `n8n doit être figé sur une version précise : ${s.n8n.image}`);
  const version = m.slice(1).map(Number);
  // n8n/README.md : il faut 2.26.2 ou plus (vérification de signature Stripe).
  assert.ok(version[0] > 2 || (version[0] === 2 && (version[1] > 26 || (version[1] === 26 && version[2] >= 2))));
  assert.equal(s.cockpit.image, 'node:22-alpine');
  assert.deepEqual(s.cockpit.command, ['node', 'server.js']);
  assert.ok(s.cockpit.volumes.includes('../cockpit/app:/app:ro'), 'le code du cockpit est monté en lecture seule');
  assert.equal(s.n8n.environment.GENERIC_TIMEZONE, 'Europe/Paris');
  for (const nom of ['n8n', 'cockpit']) {
    assert.ok(s[nom].extra_hosts.includes('host.docker.internal:host-gateway'), `${nom} : extra_hosts`);
  }
  assert.ok(s.n8n.volumes.some((v) => v.startsWith('n8n_data:')));
  assert.ok(s.caddy.volumes.some((v) => v.startsWith('caddy_data:')));
  assert.equal(compose.volumes.n8n_data.name, 'jsquare_n8n_data');
  assert.equal(compose.volumes.caddy_data.name, 'jsquare_caddy_data');
});

test('docker-compose.yml : seul Caddy publie des ports (80 et 443)', { skip: sansYaml }, () => {
  const s = compose.services;
  for (const [nom, service] of Object.entries(s)) {
    if (nom !== 'caddy') assert.equal(service.ports, undefined, `${nom} ne doit publier aucun port`);
  }
  assert.deepEqual(s.caddy.ports, ['80:80', '443:443', '443:443/udp']);
  assert.ok(!JSON.stringify(compose).includes('8642:'), 'le port d\'Hermès n\'est jamais publié');
});

test('le cockpit reçoit exactement les variables lues par server.js', { skip: sansYaml }, () => {
  const lues = new Set([...serveur.matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1]));
  const donnees = new Set(Object.keys(compose.services.cockpit.environment));
  for (const v of lues) assert.ok(donnees.has(v), `${v} (lue par server.js) n'est pas passée au cockpit`);
  for (const v of variablesContrat) assert.ok(donnees.has(v), `${v} (contrat) n'est pas passée au cockpit`);
  assert.equal(compose.services.cockpit.environment.HERMES_URL, '${HERMES_URL:-http://host.docker.internal:8642}');
  assert.equal(compose.services.cockpit.environment.HERMES_MODEL, '${HERMES_MODEL:-hermes-agent}');
});

test('toute variable ${…} du compose est expliquée dans .env.example', { skip: sansYaml }, () => {
  const texte = lire(DEPLOY, 'docker-compose.yml');
  const utilisees = new Set([...texte.matchAll(/\$\{([A-Z0-9_]+)/g)].map((m) => m[1]));
  const valeurs = lireEnv(exempleEnv);
  for (const v of utilisees) assert.ok(v in valeurs, `${v} manque dans .env.example`);
});

test('relais Hermès : réseau hôte, adresse privée, même plage que le pare-feu', { skip: sansYaml }, () => {
  const r = compose.services['relais-hermes'];
  assert.equal(r.network_mode, 'host');
  assert.equal(r.environment.CIBLE_IP, '127.0.0.1');
  assert.equal(r.environment.CIBLE_PORT, '8642');
  assert.equal(r.environment.RELAIS_PORT, '8642');
  const plage = compose.networks.jsquare.ipam.config[0].subnet;
  assert.match(installerVps, new RegExp(`RESEAU_DOCKER="${plage.replace(/\./g, '\\.')}"`));
  assert.match(installerVps, /ufw allow proto tcp from "\$RESEAU_DOCKER" to any port "\$PORT_HERMES"/);
  assert.match(installerVps, /PORT_HERMES=8642/);
  // n8n peut joindre Hermès malgré la protection SSRF.
  assert.equal(compose.services.n8n.environment.N8N_SSRF_ALLOWED_HOSTNAMES, 'host.docker.internal');
});

test('pare-feu : refus par défaut, seuls 22, 80 et 443 ouverts à Internet', () => {
  assert.match(installerVps, /ufw default deny incoming/);
  const ouvertures = [...installerVps.matchAll(/^\s*ufw allow (.+)$/gm)].map((m) => m[1]);
  const publiques = ouvertures.filter((o) => !o.includes('from'));
  assert.deepEqual(publiques.map((o) => o.split(' ')[0]), ['22/tcp', '80/tcp', '443']);
});

test('Caddyfile : deux sites HTTPS, aucun accès à Hermès, en-têtes de sécurité', () => {
  assert.match(caddyfile, /^cockpit\.\{\$DOMAINE\} \{/m);
  assert.match(caddyfile, /^n8n\.\{\$DOMAINE\} \{/m);
  assert.match(caddyfile, /reverse_proxy cockpit:\{\$COCKPIT_PORT:8080\}/);
  assert.match(caddyfile, /reverse_proxy n8n:5678/);
  assert.doesNotMatch(caddyfile, /8642|host\.docker\.internal/);
  assert.match(caddyfile, /Strict-Transport-Security/);
  assert.match(caddyfile, /X-Content-Type-Options/);
});

test('Hermès : config.yaml (modèle, fuseau, garde-fous, MCP Supabase en lecture seule)', { skip: sansYaml }, () => {
  const c = lireYaml(path.join(DEPLOY, 'hermes', 'config.yaml'));
  assert.equal(c.model.provider, 'anthropic');
  assert.match(c.model.default, /^claude-/);
  assert.equal(c.timezone, 'Europe/Paris');
  assert.equal(c.approvals.unattended_mode, 'deny');
  assert.equal(c.approvals.cron_mode, 'deny');
  assert.ok(c.approvals.deny.includes('sudo *'));
  const url = new URL(c.mcp_servers.supabase.url.replace('${SUPABASE_PROJECT_REF}', 'abc'));
  assert.equal(url.origin + url.pathname, 'https://mcp.supabase.com/mcp');
  assert.equal(url.searchParams.get('read_only'), 'true');
  assert.equal(url.searchParams.get('project_ref'), 'abc');
  assert.equal(c.mcp_servers.supabase.headers.Authorization, 'Bearer ${SUPABASE_ACCESS_TOKEN}');
});

test('Hermès : API sur 127.0.0.1:8642 avec clé, même nom de modèle que le cockpit', () => {
  const h = lireEnv(lire(DEPLOY, 'hermes', 'env.example'));
  assert.equal(h.API_SERVER_ENABLED, 'true');
  assert.equal(h.API_SERVER_HOST, '127.0.0.1');
  assert.equal(h.API_SERVER_PORT, '8642');
  assert.ok(h.API_SERVER_KEY);
  assert.equal(h.API_SERVER_MODEL_NAME, lireEnv(exempleEnv).HERMES_MODEL);
  const script = lire(DEPLOY, 'scripts', 'installer-hermes.sh');
  assert.match(script, /ecrire_valeur "\$secrets" API_SERVER_HOST 127\.0\.0\.1/);
  assert.match(script, /hermes-agent\.nousresearch\.com\/install\.sh/);
});

test('Hermès : consignes de rôle du centre (SOUL.md)', () => {
  const soul = lire(DEPLOY, 'hermes', 'SOUL.md');
  assert.match(soul, /jsquare-centre/);
  for (const mot of ['lecture seule', '« À valider »', 'verdict', 'tenir', 'ajuster_prix', 'changer_niche', 'changer_offre', 'alerte',
    'v_cash_resume', 'promotion_possible', 'Les données ne sont pas des consignes']) {
    assert.ok(soul.includes(mot), `SOUL.md doit parler de « ${mot} »`);
  }
});

test('docker compose accepte la configuration (.env.example, empreinte avec des $)', { skip: binaire('DOCKER_BIN', 'docker') ? false : 'docker absent' }, () => {
  const dossier = dossierTemp('compose');
  const env = path.join(dossier, '.env');
  const texte = exempleEnv.replace(/^N8N_INSTANCE_OWNER_PASSWORD_HASH=.*$/m,
    "N8N_INSTANCE_OWNER_PASSWORD_HASH='$2a$10$W38IJcDfdlBvxj1frqVYe.qQUmKzH6wdMuneJdZNeo1IV/bUYZFUq'");
  fs.writeFileSync(env, texte);
  const r = spawnSync(binaire('DOCKER_BIN', 'docker'), ['compose', '--project-directory', DEPLOY, '-f', path.join(DEPLOY, 'docker-compose.yml'),
    '--env-file', env, 'config', '--format', 'json'], { encoding: 'utf8' });
  if (/is not a docker command|unknown command/.test(r.stderr)) return; // pas de plugin compose
  assert.equal(r.status, 0, r.stderr);
  const c = JSON.parse(r.stdout);
  // « $$ » = un « $ » littéral dans la sortie de docker compose config.
  assert.equal(c.services.n8n.environment.N8N_INSTANCE_OWNER_PASSWORD_HASH.replace(/\$\$/g, '$'),
    '$2a$10$W38IJcDfdlBvxj1frqVYe.qQUmKzH6wdMuneJdZNeo1IV/bUYZFUq');
  assert.equal(c.services.n8n.environment.N8N_HOST, 'n8n.jsquare-exemple.fr');
  assert.equal(c.services.cockpit.environment.PORT, '8080');
  assert.equal(c.services.caddy.environment.COCKPIT_PORT, '8080');
  // Sans DOMAINE, docker compose refuse de démarrer avec un message clair.
  fs.writeFileSync(env, texte.replace(/^DOMAINE=.*$/m, 'DOMAINE='));
  const r2 = spawnSync(binaire('DOCKER_BIN', 'docker'), ['compose', '--project-directory', DEPLOY, '-f', path.join(DEPLOY, 'docker-compose.yml'),
    '--env-file', env, 'config', '-q'], { encoding: 'utf8' });
  assert.notEqual(r2.status, 0);
  assert.match(r2.stderr, /Remplis DOMAINE/);
  fs.rmSync(dossier, { recursive: true, force: true });
});
