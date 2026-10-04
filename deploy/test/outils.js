'use strict';
// Outils communs aux tests du kit de déploiement (Node 22, sans dépendance).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');

const DEPLOY = path.resolve(__dirname, '..');
const RACINE = path.resolve(DEPLOY, '..');

function lire(...morceaux) {
  return fs.readFileSync(path.join(...morceaux), 'utf8');
}

// Chemin d'un binaire : variable d'environnement, sinon PATH ; null s'il manque.
function binaire(variable, nom) {
  const choix = process.env[variable];
  if (choix) return fs.existsSync(choix) ? choix : null;
  const r = spawnSync('sh', ['-c', `command -v ${nom}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// Lit un fichier YAML avec python3 + PyYAML (installé par installer-vps.sh). null si indisponible.
function lireYaml(fichier) {
  const r = spawnSync('python3', ['-c', 'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))', fichier], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    if (/No module named|ENOENT/.test(`${r.stderr}${r.error}`)) return null;
    throw new Error(`YAML invalide (${fichier}) : ${r.stderr}`);
  }
  return JSON.parse(r.stdout);
}

// Lit un fichier .env (NOM=valeur) en objet, apostrophes retirées.
function lireEnv(texte) {
  const valeurs = {};
  for (const ligne of texte.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(ligne);
    if (m) valeurs[m[1]] = m[2].replace(/^'(.*)'$/, '$1');
  }
  return valeurs;
}

function dossierTemp(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `jsquare-test-${prefixe}-`));
}

// Port TCP libre sur 127.0.0.1.
function portLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

module.exports = { DEPLOY, RACINE, lire, binaire, lireYaml, lireEnv, dossierTemp, portLibre };
