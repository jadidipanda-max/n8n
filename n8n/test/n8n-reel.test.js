'use strict';
// Test facultatif : valide chaque nœud des workflows contre les descriptions réelles
// des nœuds n8n (version du nœud connue, aucun paramètre ignoré par n8n).
// Il ne tourne que si N8N_MODULES pointe vers un dossier node_modules qui contient
// n8n-nodes-base et n8n-workflow (par exemple après « npm install n8n »).
//   N8N_MODULES=/chemin/vers/node_modules node --test n8n/test/n8n-reel.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const build = require('../build.js');

const MODULES = process.env.N8N_MODULES || '';
const disponible = MODULES && fs.existsSync(path.join(MODULES, 'n8n-nodes-base', 'package.json')) &&
  fs.existsSync(path.join(MODULES, 'n8n-workflow', 'package.json'));

const FICHIERS_NOEUDS = {
  'n8n-nodes-base.stripeTrigger': 'Stripe/StripeTrigger.node.js',
  'n8n-nodes-base.httpRequest': 'HttpRequest/HttpRequest.node.js',
  'n8n-nodes-base.code': 'Code/Code.node.js',
  'n8n-nodes-base.if': 'If/If.node.js',
  'n8n-nodes-base.switch': 'Switch/Switch.node.js',
  'n8n-nodes-base.set': 'Set/Set.node.js',
  'n8n-nodes-base.scheduleTrigger': 'Schedule/ScheduleTrigger.node.js',
  'n8n-nodes-base.stickyNote': 'StickyNote/StickyNote.node.js',
};

function description(type, version) {
  const fichier = FICHIERS_NOEUDS[type];
  assert.ok(fichier, 'type de nœud non prévu : ' + type);
  const mod = require(path.join(MODULES, 'n8n-nodes-base', 'dist', 'nodes', fichier));
  const instance = new (Object.values(mod)[0])();
  if (instance.nodeVersions) {
    assert.ok(instance.nodeVersions[version], type + ' : version ' + version + ' inconnue');
    return instance.nodeVersions[version].description;
  }
  assert.ok([].concat(instance.description.version).includes(version), type + ' : version ' + version + ' inconnue');
  return instance.description;
}

// Chaque clé à nous doit survivre à la lecture des paramètres par n8n, avec la même valeur
function comparer(nos, resolus, chemin, ecarts) {
  if (Array.isArray(nos)) {
    if (!Array.isArray(resolus) || resolus.length !== nos.length) return ecarts.push(chemin + ' : tableau modifié');
    return nos.forEach((x, i) => comparer(x, resolus[i], chemin + '[' + i + ']', ecarts));
  }
  if (nos && typeof nos === 'object') {
    for (const k of Object.keys(nos)) {
      if (!resolus || typeof resolus !== 'object' || !(k in resolus)) ecarts.push(chemin + '.' + k + ' ignoré par n8n');
      else comparer(nos[k], resolus[k], chemin + '.' + k, ecarts);
    }
    return undefined;
  }
  if (JSON.stringify(nos) !== JSON.stringify(resolus)) ecarts.push(chemin + ' : ' + JSON.stringify(nos) + ' devient ' + JSON.stringify(resolus));
  return undefined;
}

for (const nom of Object.values(build.FICHIERS)) {
  test('paramètres reconnus par n8n : ' + nom, (t) => {
    if (!disponible) return t.skip('N8N_MODULES non défini (n8n non installé)');
    const { NodeHelpers } = require(path.join(MODULES, 'n8n-workflow'));
    const wf = JSON.parse(fs.readFileSync(path.join(build.DOSSIER_WORKFLOWS, nom), 'utf8'));
    const ecarts = [];
    for (const n of wf.nodes) {
      const d = description(n.type, n.typeVersion);
      const resolus = NodeHelpers.getNodeParameters(d.properties, n.parameters, true, false, n, d);
      comparer(n.parameters, resolus, n.name, ecarts);
    }
    assert.deepEqual(ecarts, []);
    return undefined;
  });
}
