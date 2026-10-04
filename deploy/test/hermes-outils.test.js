'use strict';
// Hermès sans terminal : la configuration, la fusion faite par installer-hermes.sh
// et la vérification des outils de l'API (GET /v1/toolsets) qui arrête le service au moindre doute.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DEPLOY, lire, lireYaml, dossierTemp } = require('./outils');

const script = lire(DEPLOY, 'scripts', 'installer-hermes.sh');
const modele = path.join(DEPLOY, 'hermes', 'config.yaml');
const config = lireYaml(modele);
const sansYaml = config === null ? 'python3-yaml absent' : false;

// Toolsets qui donnent accès au shell, aux fichiers (donc à ~/.hermes/.env), au code ou au réseau
const DANGEREUX = ['terminal', 'file', 'code_execution', 'web', 'search', 'browser', 'delegation', 'cronjob',
  'computer_use', 'connections', 'skills', 'coding', 'debugging', 'safe', 'all', '*'];

// Le code Python collé dans le script (entre deux marqueurs)
function extraire(debut, fin) {
  const i = script.indexOf(debut);
  assert.ok(i >= 0, `marqueur introuvable : ${debut}`);
  const j = script.indexOf(fin, i + debut.length);
  assert.ok(j > i, `fin introuvable : ${fin}`);
  return script.slice(i + debut.length, j);
}
const FUSION = extraire(`python3 - "$dest" "$modele" <<'PY'\n`, '\nPY\n');
const OUTILS = extraire("outils_dangereux() {\n  python3 -c '\n", "\n'\n}");

test('config.yaml : l\'API n\'a que la base en lecture seule et sa mémoire', { skip: sansYaml }, () => {
  const api = config.platform_toolsets.api_server;
  assert.ok(api.includes('mcp-supabase'), 'la base (MCP Supabase) reste accessible');
  for (const t of api) {
    assert.ok(!DANGEREUX.includes(t) && !t.startsWith('hermes-'), `outil dangereux sur l'API : ${t}`);
  }
  for (const t of config.platform_toolsets.cron) assert.ok(!DANGEREUX.includes(t) && !t.startsWith('hermes-'), `cron : ${t}`);
  for (const t of ['terminal', 'file', 'code_execution', 'web', 'browser', 'delegation']) {
    assert.ok(config.agent.disabled_toolsets.includes(t), `${t} doit être coupé pour tous les canaux`);
  }
  // filet si un terminal revenait : lecture des secrets et sorties réseau bloquées
  for (const motif of ['*.env*', '*printenv*', 'env', 'curl *', 'wget *']) assert.ok(config.approvals.deny.includes(motif), motif);
});

test('fusion de installer-hermes.sh : une ancienne liste d\'outils est remplacée, pas complétée', { skip: sansYaml }, () => {
  const dossier = dossierTemp('fusion');
  try {
    const dest = path.join(dossier, 'config.yaml');
    // config d'Hermès déjà en place : API avec tous les outils, modèle choisi par Jay, règle perso
    fs.writeFileSync(dest, [
      'model:', '  provider: anthropic', '  default: claude-sonnet-5-5',
      'platform_toolsets:', '  api_server: [hermes-api-server]', '  cli: [hermes-cli]',
      'agent:', '  disabled_toolsets: [tts]',
      'approvals:', '  deny:', "    - 'rm -rf /*'", '',
    ].join('\n'));
    const r = spawnSync('python3', ['-', dest, modele], { input: FUSION, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const resultat = lireYaml(dest);
    assert.deepEqual(resultat.platform_toolsets.api_server, config.platform_toolsets.api_server);
    assert.ok(!resultat.platform_toolsets.api_server.includes('hermes-api-server'));
    assert.deepEqual(resultat.platform_toolsets.cli, ['hermes-cli'], 'les autres canaux ne bougent pas');
    assert.equal(resultat.model.default, 'claude-sonnet-5-5', 'le modèle choisi est gardé');
    assert.ok(resultat.agent.disabled_toolsets.includes('tts') && resultat.agent.disabled_toolsets.includes('terminal'));
    assert.ok(resultat.approvals.deny.includes('rm -rf /*') && resultat.approvals.deny.includes('sudo *'));
    assert.equal(fs.statSync(dest).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

function verifier(reponse) {
  return spawnSync('python3', ['-c', OUTILS], { input: typeof reponse === 'string' ? reponse : JSON.stringify(reponse), encoding: 'utf8' });
}

test('vérification GET /v1/toolsets : signale terminal, fichiers, code, web et navigateur actifs', () => {
  const sur = { object: 'list', platform: 'api_server', data: [
    { name: 'memory', enabled: true, tools: ['memory'] },
    { name: 'todo', enabled: true, tools: ['todo_list'] },
    { name: 'terminal', enabled: false, tools: ['process_manage', 'terminal'] },
    { name: 'file', enabled: false, tools: ['patch', 'read_file', 'search_files', 'write_file'] },
  ] };
  let r = verifier(sur);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '', 'rien de dangereux');

  const risque = JSON.parse(JSON.stringify(sur));
  risque.data[2].enabled = true;
  risque.data[3].enabled = true;
  risque.data.push({ name: 'browser', enabled: true, tools: ['browser_navigate'] });
  risque.data.push({ name: 'code_execution', enabled: true, tools: ['execute_code'] });
  r = verifier(risque);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split(' '),
    ['browser_navigate', 'execute_code', 'patch', 'process_manage', 'read_file', 'search_files', 'terminal', 'write_file']);

  // réponse illisible (erreur 401, page HTML) : code 1, le script s'arrête
  assert.equal(verifier('<html>401</html>').status, 1);
  assert.equal(verifier({ error: { message: 'Invalid API key' } }).status, 1);
});

test('installer-hermes.sh arrête Hermès si un outil dangereux reste actif sur l\'API', () => {
  const bloc = script.slice(script.indexOf('etape "Outils de l\'API'));
  assert.match(bloc, /\/v1\/toolsets/);
  assert.match(bloc, /outils_dangereux\)" \|\| erreur/);
  assert.match(bloc, /gateway stop/);
  // la clé passe par l'entrée standard de curl, pas par la ligne de commande
  assert.match(bloc, /--config - "http:\/\/127\.0\.0\.1:\$PORT_HERMES\/v1\/toolsets"/);
});
