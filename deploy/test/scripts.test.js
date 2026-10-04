'use strict';
// Tests des scripts du serveur (deploy/scripts/) : syntaxe, shellcheck, et exécutions réelles
// de configurer.sh, sauvegarde.sh et restaurer.sh dans des dossiers temporaires.
// Docker et Hermès sont remplacés par de faux programmes qui notent ce qu'on leur demande.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DEPLOY, binaire, lireEnv } = require('./outils');

const SCRIPTS = ['installer-vps.sh', 'configurer.sh', 'installer-hermes.sh', 'sauvegarde.sh', 'restaurer.sh'];
const estRoot = process.getuid && process.getuid() === 0;
const RUNUSER = binaire('RUNUSER_BIN', 'runuser');
const CADDY = binaire('CADDY_BIN', 'caddy');

// Dossier temporaire lisible par tous (les scripts tournent aussi sous « nobody »).
function dossierOuvert(prefixe) {
  const d = fs.mkdtempSync(path.join('/tmp', `jsquare-test-${prefixe}-`));
  fs.chmodSync(d, 0o755);
  return d;
}

function ecrireExecutable(fichier, contenu) {
  fs.writeFileSync(fichier, contenu);
  fs.chmodSync(fichier, 0o755);
}

// Copie du kit (ce dont les scripts ont besoin) dans un dossier temporaire.
function copierDeploy(cible) {
  for (const f of ['.env.example', 'docker-compose.yml', 'Caddyfile']) fs.copyFileSync(path.join(DEPLOY, f), path.join(cible, f));
  fs.cpSync(path.join(DEPLOY, 'scripts'), path.join(cible, 'scripts'), { recursive: true });
  fs.cpSync(path.join(DEPLOY, 'hermes'), path.join(cible, 'hermes'), { recursive: true });
}

test('chaque script : bash -n, set -euo pipefail, aide en français', () => {
  for (const s of SCRIPTS) {
    const fichier = path.join(DEPLOY, 'scripts', s);
    const r = spawnSync('bash', ['-n', fichier], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${s} : ${r.stderr}`);
    const texte = fs.readFileSync(fichier, 'utf8');
    assert.match(texte, /^#!\/usr\/bin\/env bash\n/, `${s} : shebang`);
    assert.match(texte, /^set -euo pipefail$/m, `${s} : set -euo pipefail`);
    assert.match(texte.split('\n')[1], /^# [A-ZÉ]/, `${s} : commentaire d'en-tête`);
  }
});

test('shellcheck ne signale rien', { skip: binaire('SHELLCHECK_BIN', 'shellcheck') ? false : 'shellcheck absent (SHELLCHECK_BIN)' }, () => {
  const r = spawnSync(binaire('SHELLCHECK_BIN', 'shellcheck'), ['-x', ...SCRIPTS], { cwd: path.join(DEPLOY, 'scripts'), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('installer-vps.sh : étapes attendues, chacune relançable', () => {
  const t = fs.readFileSync(path.join(DEPLOY, 'scripts', 'installer-vps.sh'), 'utf8');
  for (const motif of [
    /apt-get -y -q .* upgrade/, /timedatectl set-timezone "\$FUSEAU"/, /FUSEAU="Europe\/Paris"/,
    /if ! id "\$UTILISATEUR" >\/dev\/null 2>&1; then\s+adduser/, /download\.docker\.com\/linux\/ubuntu\/gpg/,
    /docker-ce docker-ce-cli containerd\.io docker-buildx-plugin docker-compose-plugin/,
    /dpkg -s docker-ce >\/dev\/null 2>&1 && docker compose version/, /ufw --force enable/,
    /\/etc\/cron\.d\/jsquare-sauvegarde/, /sauvegarde\.sh/, /loginctl enable-linger "\$UTILISATEUR_HERMES"/,
  ]) assert.match(t, motif);
  // Hermès n'a ni sudo ni Docker.
  assert.match(t, /gpasswd -d "\$UTILISATEUR_HERMES" sudo/);
  assert.match(t, /gpasswd -d "\$UTILISATEUR_HERMES" docker/);
});

test('configurer.sh : crée .env, puis relancé ne redemande rien et ne change aucune clé',
  { skip: !CADDY ? 'binaire caddy absent (CADDY_BIN), nécessaire pour l\'empreinte du mot de passe' : (estRoot && !RUNUSER ? 'runuser absent' : false), timeout: 60_000 },
  (t) => {
    const racine = dossierOuvert('configurer');
    t.after(() => fs.rmSync(racine, { recursive: true, force: true }));
    const deploy = path.join(racine, 'deploy');
    fs.mkdirSync(deploy);
    copierDeploy(deploy);
    const caddy = path.join(racine, 'caddy');
    fs.copyFileSync(CADDY, caddy);
    fs.chmodSync(caddy, 0o755);
    const maison = path.join(racine, 'maison');
    fs.mkdirSync(maison);
    if (estRoot) spawnSync('chown', ['-R', 'nobody:nogroup', racine]);

    // configurer.sh refuse root : sous root, on le lance avec le compte « nobody ».
    const lancer = (entree, args = []) => {
      const commande = ['env', `HOME=${maison}`, `PATH=${process.env.PATH}`, `CADDY_BIN=${caddy}`, 'bash', path.join(deploy, 'scripts', 'configurer.sh'), ...args];
      const [prog, ...reste] = estRoot ? [RUNUSER, '-u', 'nobody', '--', ...commande] : commande;
      return spawnSync(prog, reste, { input: entree, encoding: 'utf8', cwd: racine });
    };

    const reponses = [
      'https://www.Exemple-Test.fr/', // domaine (nettoyé)
      'pas-un-email', 'jay@exemple-test.fr', // e-mail refusé puis accepté
      'https://qrstuvwxyzabcdef.supabase.co/', 'sb_publishable_TEST123', 'sb_secret_TEST456',
      '', // e-mail n8n : celui par défaut
      'faible', 'MotDePasse42', 'MotDePasse42', // mot de passe trop simple puis accepté
    ].join('\n') + '\n';
    const r1 = lancer(reponses);
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    const fichier = path.join(deploy, '.env');
    assert.equal(fs.statSync(fichier).mode & 0o777, 0o600, '.env lisible par son propriétaire seulement');
    const env1 = lireEnv(fs.readFileSync(fichier, 'utf8'));
    assert.equal(env1.DOMAINE, 'exemple-test.fr');
    assert.equal(env1.EMAIL_ACME, 'jay@exemple-test.fr');
    assert.equal(env1.SUPABASE_URL, 'https://qrstuvwxyzabcdef.supabase.co');
    assert.equal(env1.SUPABASE_PUBLISHABLE_KEY, 'sb_publishable_TEST123');
    assert.equal(env1.SUPABASE_SECRET_KEY, 'sb_secret_TEST456');
    assert.match(env1.N8N_ENCRYPTION_KEY, /^[0-9a-f]{64}$/);
    assert.match(env1.HERMES_API_KEY, /^[0-9a-f]{64}$/);
    assert.notEqual(env1.N8N_ENCRYPTION_KEY, env1.HERMES_API_KEY);
    assert.equal(env1.N8N_INSTANCE_OWNER_MANAGED_BY_ENV, 'true');
    assert.equal(env1.N8N_INSTANCE_OWNER_EMAIL, 'jay@exemple-test.fr');
    assert.match(env1.N8N_INSTANCE_OWNER_PASSWORD_HASH, /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/);
    assert.match(fs.readFileSync(fichier, 'utf8'), /^N8N_INSTANCE_OWNER_PASSWORD_HASH='\$2/m, 'empreinte entre apostrophes');
    assert.doesNotMatch(fs.readFileSync(fichier, 'utf8'), /MotDePasse42/, 'jamais le mot de passe en clair');
    assert.match(r1.stdout, /Ce n'est pas une adresse e-mail valable/);
    assert.match(r1.stdout, /Trop simple/);
    // Valeurs non demandées : celles du modèle.
    assert.equal(env1.HERMES_URL, 'http://host.docker.internal:8642');
    assert.equal(env1.PORT, '8080');

    // Relancé sans rien taper : aucune question bloquante, aucune clé changée.
    const r2 = lancer('');
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    const env2 = lireEnv(fs.readFileSync(fichier, 'utf8'));
    assert.deepEqual(env2, env1);
    assert.match(r2.stdout, /déjà là \(on n'y touche jamais\)/);

    // --supabase puis Entrée : Supabase vidé, le cockpit passera en mode démo ; le reste ne bouge pas.
    const r3 = lancer('\n', ['--supabase']);
    assert.equal(r3.status, 0, r3.stdout + r3.stderr);
    const env3 = lireEnv(fs.readFileSync(fichier, 'utf8'));
    assert.equal(env3.SUPABASE_URL, '');
    assert.equal(env3.SUPABASE_SECRET_KEY, '');
    assert.equal(env3.N8N_ENCRYPTION_KEY, env1.N8N_ENCRYPTION_KEY);
    assert.match(r3.stdout, /mode démo/);

    fs.rmSync(racine, { recursive: true, force: true });
  });

test('configurer.sh refuse de tourner en root', { skip: estRoot ? false : 'pas root' }, () => {
  const r = spawnSync('bash', [path.join(DEPLOY, 'scripts', 'configurer.sh')], { input: '', encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sans sudo/);
});

// ─── Sauvegarde et restauration (faux docker, faux hermes) ──────────────────
const FAUX_DOCKER = `#!/usr/bin/env bash
# Faux docker : note chaque appel et simule n8n, les volumes et docker compose.
e="$FAUX_ETAT"
echo "$*" >>"$e/appels.log"
case "$1" in
  ps) if [[ -f "$e/n8n-en-marche" ]]; then echo c0ffee; fi ;;
  stop) rm -f "$e/n8n-en-marche" ;;
  start) touch "$e/n8n-en-marche" ;;
  volume)
    nom="\${*: -1}"
    [[ -d "$e/volumes/$nom" ]] || exit 1
    if [[ "$3" == "-f" ]]; then
      if [[ "$nom" == jsquare_n8n_data && -f "$e/n8n-en-marche" ]]; then echo "copie pendant que n8n tourne" >>"$e/erreurs.log"; fi
      echo "$e/volumes/$nom"
    fi ;;
  compose)
    shift 3
    case "$1 \${2:-}" in
      "down "*) rm -f "$e/n8n-en-marche" ;;
      "up --no-start") mkdir -p "$e/volumes/jsquare_n8n_data" "$e/volumes/jsquare_caddy_data" ;;
      "up -d") touch "$e/n8n-en-marche" ;;
      *) echo "appel compose inattendu : $*" >>"$e/erreurs.log" ;;
    esac ;;
  *) echo "appel inattendu : $*" >>"$e/erreurs.log" ;;
esac
`;

const FAUX_HERMES = `#!/usr/bin/env bash
# Faux hermes : backup écrit un zip factice, import le recopie, gateway ne fait rien.
echo "$(id -un) $*" >>"$FAUX_JOURNAL_HERMES"
case "$1" in
  backup) printf 'zip-hermes-factice' >"$3" ;;
  import) cp "\${@: -1}" "$FAUX_ETAT_HERMES/importe.zip" ;;
esac
`;

function preparerFaux() {
  const racine = dossierOuvert('sauvegarde');
  const deploy = path.join(racine, 'deploy');
  fs.mkdirSync(deploy);
  copierDeploy(deploy);
  const etat = path.join(racine, 'etat');
  fs.mkdirSync(path.join(etat, 'volumes', 'jsquare_n8n_data'), { recursive: true });
  fs.mkdirSync(path.join(etat, 'volumes', 'jsquare_caddy_data', 'caddy'), { recursive: true });
  fs.writeFileSync(path.join(etat, 'volumes', 'jsquare_n8n_data', 'database.sqlite'), 'base-n8n-v1');
  fs.chownSync(path.join(etat, 'volumes', 'jsquare_n8n_data', 'database.sqlite'), 1000, 1000);
  fs.writeFileSync(path.join(etat, 'volumes', 'jsquare_caddy_data', 'caddy', 'cert.pem'), 'certificat');
  fs.writeFileSync(path.join(etat, 'n8n-en-marche'), '');
  fs.writeFileSync(path.join(deploy, '.env'), 'DOMAINE=exemple-test.fr\nN8N_ENCRYPTION_KEY=cle-v1\n', { mode: 0o600 });
  const bin = path.join(racine, 'bin');
  fs.mkdirSync(bin);
  fs.chmodSync(bin, 0o755);
  ecrireExecutable(path.join(bin, 'docker'), FAUX_DOCKER);
  ecrireExecutable(path.join(bin, 'hermes'), FAUX_HERMES);
  const etatHermes = path.join(racine, 'hermes');
  fs.mkdirSync(etatHermes, { mode: 0o777 });
  fs.chmodSync(etatHermes, 0o777);
  const sauvegardes = path.join(racine, 'sauvegardes');
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, FAUX_ETAT: etat, FAUX_ETAT_HERMES: etatHermes,
    FAUX_JOURNAL_HERMES: path.join(etatHermes, 'journal.log'), DOSSIER_SAUVEGARDES: sauvegardes,
    UTILISATEUR_HERMES: 'nobody', HERMES_BIN: path.join(bin, 'hermes'),
  };
  return { racine, deploy, etat, etatHermes, sauvegardes, env };
}

const lireSiExiste = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

test('sauvegarde.sh puis restaurer.sh : archive complète, n8n arrêté pendant la copie, retour à l\'identique',
  { skip: estRoot && RUNUSER ? false : 'il faut root et runuser (comme sur le serveur)', timeout: 60_000 },
  (t) => {
    const f = preparerFaux();
    t.after(() => fs.rmSync(f.racine, { recursive: true, force: true }));
    // Deux vieilles archives : une de 20 jours (effacée), une d'hier (gardée).
    fs.mkdirSync(f.sauvegardes, { recursive: true, mode: 0o700 });
    const vieille = path.join(f.sauvegardes, 'jsquare-2026-09-01_033000.tar.gz');
    const recente = path.join(f.sauvegardes, 'jsquare-2026-10-03_033000.tar.gz');
    fs.writeFileSync(vieille, 'x');
    fs.writeFileSync(recente, 'x');
    const ilYa = (jours) => new Date(Date.now() - jours * 86_400_000);
    fs.utimesSync(vieille, ilYa(20), ilYa(20));
    fs.utimesSync(recente, ilYa(1), ilYa(1));

    const s = spawnSync('bash', [path.join(f.deploy, 'scripts', 'sauvegarde.sh')], { env: f.env, encoding: 'utf8' });
    assert.equal(s.status, 0, s.stdout + s.stderr);
    assert.equal(lireSiExiste(path.join(f.etat, 'erreurs.log')), '', 'n8n arrêté pendant la copie, aucun appel inattendu');
    assert.ok(fs.existsSync(path.join(f.etat, 'n8n-en-marche')), 'n8n redémarré');
    assert.match(lireSiExiste(path.join(f.etat, 'appels.log')), /stop -t 60 c0ffee[\s\S]*start c0ffee/);
    assert.match(lireSiExiste(path.join(f.etatHermes, 'journal.log')), /^nobody backup -o \/tmp\/jsquare-hermes-\w+\/hermes\.zip/m,
      'hermes backup lancé avec le compte d\'Hermès');

    const archives = fs.readdirSync(f.sauvegardes).filter((n) => /^jsquare-.*\.tar\.gz$/.test(n)).sort();
    assert.equal(archives.length, 2, `archives : ${archives}`);
    assert.ok(!archives.includes(path.basename(vieille)), 'archive de plus de 14 jours effacée');
    assert.ok(archives.includes(path.basename(recente)), 'archive récente gardée');
    const nouvelle = path.join(f.sauvegardes, archives.find((n) => n !== path.basename(recente)));
    assert.equal(fs.statSync(nouvelle).mode & 0o777, 0o600);
    assert.equal(fs.statSync(f.sauvegardes).mode & 0o777, 0o700);
    assert.equal(fs.readdirSync(f.sauvegardes).filter((n) => n.startsWith('.')).length, 0, 'aucun fichier temporaire laissé');
    const contenu = spawnSync('tar', ['-tzf', nouvelle], { encoding: 'utf8' }).stdout.split('\n').map((l) => l.replace(/^\.\//, '')).filter(Boolean).sort();
    assert.deepEqual(contenu.filter((l) => l !== '.' && l !== ''), ['LISEZMOI.txt', 'deploy.env', 'hermes.zip', 'jsquare_caddy_data.tar', 'jsquare_n8n_data.tar']);
    assert.match(lireSiExiste(path.join(f.sauvegardes, 'derniere-sauvegarde.txt')), /Tout est OK/);

    // Tout casser, puis restaurer.
    fs.rmSync(path.join(f.etat, 'volumes'), { recursive: true, force: true });
    fs.writeFileSync(path.join(f.deploy, '.env'), 'DOMAINE=autre.fr\nN8N_ENCRYPTION_KEY=cle-v2\n', { mode: 0o600 });
    fs.writeFileSync(path.join(f.etat, 'appels.log'), '');
    const r = spawnSync('bash', [path.join(f.deploy, 'scripts', 'restaurer.sh'), '--oui', nouvelle], { env: f.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(lireSiExiste(path.join(f.etat, 'erreurs.log')), '');
    const base = path.join(f.etat, 'volumes', 'jsquare_n8n_data', 'database.sqlite');
    assert.equal(fs.readFileSync(base, 'utf8'), 'base-n8n-v1');
    assert.equal(fs.statSync(base).uid, 1000, 'propriétaire du fichier n8n gardé');
    assert.equal(fs.readFileSync(path.join(f.etat, 'volumes', 'jsquare_caddy_data', 'caddy', 'cert.pem'), 'utf8'), 'certificat');
    assert.match(fs.readFileSync(path.join(f.deploy, '.env'), 'utf8'), /N8N_ENCRYPTION_KEY=cle-v1/, '.env de la sauvegarde remis');
    const copies = fs.readdirSync(f.deploy).filter((n) => n.startsWith('.env.avant-restauration-'));
    assert.equal(copies.length, 1, 'ancien .env gardé à côté');
    assert.match(fs.readFileSync(path.join(f.deploy, copies[0]), 'utf8'), /cle-v2/);
    assert.match(lireSiExiste(path.join(f.etat, 'appels.log')), /compose --project-directory \S+ down[\s\S]*up --no-start[\s\S]*up -d/);
    const journalHermes = lireSiExiste(path.join(f.etatHermes, 'journal.log'));
    assert.match(journalHermes, /^nobody gateway stop$/m);
    assert.match(journalHermes, /^nobody import --force \/tmp\/jsquare-import-\w+\/hermes\.zip$/m);
    assert.match(journalHermes, /^nobody gateway start$/m);
    assert.equal(fs.readFileSync(path.join(f.etatHermes, 'importe.zip'), 'utf8'), 'zip-hermes-factice');
    fs.rmSync(f.racine, { recursive: true, force: true });
  });

test('sauvegarde.sh : si la copie échoue, n8n redémarre quand même et rien de partiel ne reste',
  { skip: estRoot && RUNUSER ? false : 'il faut root et runuser', timeout: 30_000 },
  (t) => {
    const f = preparerFaux();
    t.after(() => fs.rmSync(f.racine, { recursive: true, force: true }));
    // Le faux docker annonce un dossier de volume qui n'existe pas.
    fs.writeFileSync(path.join(f.racine, 'bin', 'docker'), FAUX_DOCKER.replace('echo "$e/volumes/$nom"', 'echo "$e/disparu/$nom"'));
    const s = spawnSync('bash', [path.join(f.deploy, 'scripts', 'sauvegarde.sh')], { env: f.env, encoding: 'utf8' });
    assert.notEqual(s.status, 0);
    assert.match(s.stderr, /introuvable/);
    assert.ok(fs.existsSync(path.join(f.etat, 'n8n-en-marche')), 'n8n redémarré malgré l\'erreur');
    assert.deepEqual(fs.readdirSync(f.sauvegardes), [], 'aucune archive ni fichier temporaire');
    fs.rmSync(f.racine, { recursive: true, force: true });
  });

test('restaurer.sh : refuse une archive qui n\'est pas une sauvegarde, sans rien toucher',
  { skip: estRoot ? false : 'il faut root' },
  (t) => {
    const f = preparerFaux();
    t.after(() => fs.rmSync(f.racine, { recursive: true, force: true }));
    const faux = path.join(f.racine, 'autre.tar.gz');
    spawnSync('tar', ['-czf', faux, '-C', f.etat, 'volumes']);
    const r = spawnSync('bash', [path.join(f.deploy, 'scripts', 'restaurer.sh'), '--oui', faux], { env: f.env, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /pas une sauvegarde du cockpit/);
    assert.equal(lireSiExiste(path.join(f.etat, 'appels.log')), '', 'docker jamais appelé');
    // Sans --oui, une réponse autre que « oui » annule.
    const s = spawnSync('bash', [path.join(f.deploy, 'scripts', 'sauvegarde.sh')], { env: f.env, encoding: 'utf8' });
    assert.equal(s.status, 0, s.stderr);
    const archive = fs.readdirSync(f.sauvegardes).find((n) => n.endsWith('.tar.gz'));
    fs.writeFileSync(path.join(f.etat, 'appels.log'), '');
    const n = spawnSync('bash', [path.join(f.deploy, 'scripts', 'restaurer.sh'), path.join(f.sauvegardes, archive)], { env: f.env, input: 'non\n', encoding: 'utf8' });
    assert.notEqual(n.status, 0);
    assert.match(n.stderr, /annulée/);
    assert.equal(lireSiExiste(path.join(f.etat, 'appels.log')), '');
    fs.rmSync(f.racine, { recursive: true, force: true });
  });
