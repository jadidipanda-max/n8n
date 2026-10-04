'use strict';
// Le guide deploy/README.md : ordre du contrat, noms réels des autres briques,
// et le SQL que Jay colle dans Supabase, exécuté sur un vrai Postgres (stub Supabase + vraie migration).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DEPLOY, RACINE, lire, binaire } = require('./outils');

const guide = lire(DEPLOY, 'README.md');
const n8nReadme = lire(RACINE, 'n8n', 'README.md');

test('les 8 étapes du contrat, dans l\'ordre, puis sauvegardes et dépannage', () => {
  const titres = [...guide.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const etapes = titres.filter((t) => /^Étape \d/.test(t));
  assert.deepEqual(etapes.map((t) => t.match(/^Étape (\d)/)[1]), ['1', '2', '3', '4', '5', '6', '7', '8']);
  const attendus = [/VPS/, /DNS/, /Supabase/, /Stripe/, /docker compose up/, /Hermès/, /n8n/, /[Vv]érification/];
  etapes.forEach((t, i) => assert.match(t, attendus[i], `étape ${i + 1} : ${t}`));
  for (const section of ['Sauvegardes', 'Si ça ne marche pas']) assert.ok(titres.includes(section), section);
  // Chaque étape dit ce qu'on voit et comment vérifier.
  const blocs = guide.split(/^## Étape \d\./m).slice(1);
  blocs.forEach((b, i) => {
    if (i < 7) assert.match(b, /\*\*(Tu vois|Vérifie)\*\*/, `étape ${i + 1} : « Tu vois » ou « Vérifie »`);
  });
});

test('Supabase : comptes, profils, inscriptions fermées, région Paris', () => {
  for (const texte of ['Authentication > Users > Add user > Create new user', 'Auto Confirm User', 'Allow new users to sign up',
    'West EU (Paris)', 'insert into public.profils', 'SQL Editor', 'Redirect URLs', 'sb_publishable_', 'sb_secret_']) {
    assert.ok(guide.includes(texte), `le guide doit parler de « ${texte} »`);
  }
});

test('les fichiers et scripts cités existent vraiment', () => {
  const chemins = new Set([...guide.matchAll(/`((?:supabase|n8n|cockpit|deploy)\/[\w./-]+\.(?:sql|json|js|md|sh))`/g)].map((m) => m[1]));
  assert.ok(chemins.has('supabase/migrations/20261003000000_cockpit.sql'));
  assert.ok(chemins.has('n8n/workflows/stripe-vers-supabase.json'));
  assert.ok(chemins.has('n8n/workflows/rapport-du-soir.json'));
  for (const c of chemins) assert.ok(fs.existsSync(path.join(RACINE, c)), `${c} n'existe pas`);
  const scripts = new Set([...guide.matchAll(/\/opt\/jsquare\/deploy\/scripts\/([\w-]+\.sh)/g)].map((m) => m[1]));
  assert.ok(scripts.size >= 5);
  for (const s of scripts) assert.ok(fs.existsSync(path.join(DEPLOY, 'scripts', s)), `${s} n'existe pas`);
  // Options citées dans le guide = options acceptées par configurer.sh.
  const configurer = lire(DEPLOY, 'scripts', 'configurer.sh');
  for (const option of guide.matchAll(/configurer\.sh (--[\w-]+)/g)) {
    assert.ok(configurer.includes(`${option[1]})`), `option ${option[1]} inconnue de configurer.sh`);
  }
});

test('n8n : mêmes noms d\'identifiants et de réglages que n8n/README.md', () => {
  for (const nom of ['Stripe J-Square', 'Supabase n8n (clé secrète)', 'Hermès API']) {
    assert.ok(n8nReadme.includes(`\`${nom}\``), `n8n/README.md ne connaît pas ${nom}`);
    assert.ok(guide.includes(`\`${nom}\``), `le guide doit citer ${nom}`);
  }
  for (const reglage of ['supabaseUrl', 'hermesUrl', 'hermesModel']) assert.ok(guide.includes(`\`${reglage}\``));
  const rapport = JSON.parse(lire(RACINE, 'n8n', 'workflows', 'rapport-du-soir.json'));
  assert.match(JSON.stringify(rapport), /http:\/\/host\.docker\.internal:8642/, 'même adresse d\'Hermès que le guide');
  assert.ok(guide.includes('http://host.docker.internal:8642'));
});

test('fiches clients, double authentification n8n, signature Stripe et tables à la main sont expliquées', () => {
  // fiches clients : créées par n8n, ou à la main avec le stripe_customer_id
  assert.match(guide, /### 4\.3 La fiche de chaque client/);
  for (const texte of ['Table Editor > clients', '`stripe_customer_id`', 'cus_…']) assert.ok(guide.includes(texte), texte);
  // n8n : double authentification dès la première connexion
  assert.match(guide, /Two-factor authentication/);
  assert.match(guide, /codes de secours/);
  // Stripe : un événement non signé doit recevoir 401
  assert.match(guide, /Signature Secret\*\* n'est pas facultatif/);
  assert.match(guide, /curl [^\n]*-X POST[^\n]*Production URL/);
  assert.match(guide, /\*\*Tu vois\*\* `401`/);
  // tables que les deux workflows ne remplissent pas
  const section = guide.slice(guide.indexOf('### Ce que les deux workflows ne remplissent pas'));
  for (const table of ['appels', 'objectifs', 'couts', 'agents_etat']) assert.ok(section.includes(`| \`${table}\` |`), table);
  // Hermès : pas de terminal, vérifié par le script
  assert.ok(guide.includes("L'API n'a que la base en lecture seule (MCP Supabase) et sa mémoire."));
  assert.ok(lire(DEPLOY, 'scripts', 'installer-hermes.sh').includes("L'API n'a que la base en lecture seule (MCP Supabase) et sa mémoire."));
});

test('le relais et le pare-feu sont expliqués, l\'API Hermès reste fermée', () => {
  for (const texte of ['127.0.0.1:8642', 'relais-hermes', '172.30.10.0/24', 'host.docker.internal', 'jamais exposée']) {
    assert.ok(guide.includes(texte), texte);
  }
});

// ─── Le SQL du guide sur un vrai Postgres ───────────────────────────────────
function postgresDisponible() {
  if (!(process.getuid && process.getuid() === 0)) return 'il faut root (su postgres), comme supabase/tests/run.sh';
  if (!binaire('PG_LSCLUSTERS_BIN', 'pg_lsclusters')) return 'Postgres absent';
  return false;
}

function psql(base, sql) {
  return spawnSync('su', ['postgres', '-c', `psql -X -q -A -t -v ON_ERROR_STOP=1 -d ${base}`], { input: sql, encoding: 'utf8' });
}

test('le SQL du guide crée les profils de Jay et Junior, et se relance sans erreur', { skip: postgresDisponible(), timeout: 60_000 }, (t) => {
  const base = `guide_test_${Date.now()}`;
  let demarre = false;
  // Nettoyage dans l'ordre : la base jetable d'abord, puis le cluster s'il a été démarré ici.
  t.after(() => {
    psql('postgres', `drop database if exists ${base} with (force);`);
    if (demarre) spawnSync('pg_ctlcluster', ['16', 'main', 'stop']);
  });
  const liste = spawnSync('pg_lsclusters', ['--no-header'], { encoding: 'utf8' }).stdout;
  if (!/^16\s+main\s+\d+\s+online/m.test(liste)) {
    const r = spawnSync('pg_ctlcluster', ['16', 'main', 'start'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    demarre = true;
  }
  for (let i = 0; i < 30 && psql('postgres', 'select 1;').status !== 0; i += 1) spawnSync('sleep', ['0.5']);
  assert.equal(psql('postgres', `create database ${base};`).status, 0);

  const stub = lire(RACINE, 'supabase', 'tests', 'stub_supabase.sql');
  const migration = lire(RACINE, 'supabase', 'migrations', '20261003000000_cockpit.sql');
  let r = psql(base, `${stub}\n${migration}`);
  assert.equal(r.status, 0, r.stderr);
  // Les comptes créés dans Authentication > Users (les e-mails d'exemple du guide), et un intrus.
  r = psql(base, `insert into auth.users (id, email) values
    (gen_random_uuid(), 'jay@exemple.fr'), (gen_random_uuid(), 'junior@exemple.com'), (gen_random_uuid(), 'inconnu@exemple.org');`);
  assert.equal(r.status, 0, r.stderr);

  const blocs = [...guide.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(blocs.length, 3, 'trois blocs SQL : contrôle de la migration, profils, vérification');
  const [controle, profils, verification] = blocs;

  r = psql(base, controle);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), ['change', 'cotisations', 'objectif_mensuel', 'partage', 'seuils']);

  for (let passage = 1; passage <= 2; passage += 1) {
    r = psql(base, profils);
    assert.equal(r.status, 0, `passage ${passage} : ${r.stderr}`);
  }
  r = psql(base, verification);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), ['jay@exemple.fr|Jay|admin|fr', 'junior@exemple.com|Junior|associe|us']);

  // Avec ces profils, les fonctions du contrat donnent les bons droits.
  const droits = (email) => psql(base, `select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = '${email}'), false);
    select public.est_membre() || '|' || public.est_admin() || '|' || coalesce(public.mon_marche(), '-');`).stdout.trim().split('\n').pop();
  assert.equal(droits('jay@exemple.fr'), 'true|true|fr');
  assert.equal(droits('junior@exemple.com'), 'true|false|us');
  assert.equal(droits('inconnu@exemple.org'), 'false|false|-', 'un compte sans profil ne voit rien');
});
