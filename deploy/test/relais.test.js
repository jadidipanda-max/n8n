'use strict';
// Tests du relais TCP vers Hermès (deploy/hermes/relais-hermes.js) : vraies connexions locales.

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DEPLOY, portLibre } = require('./outils');

const relais = require('../hermes/relais-hermes.js');

test('adresses d\'écoute : privées acceptées, publiques et 0.0.0.0 refusées', () => {
  for (const ip of ['172.17.0.1', '172.30.10.1', '10.0.0.1', '192.168.1.10', '127.0.0.1']) {
    assert.equal(relais.adresseAutorisee(ip), true, ip);
  }
  for (const ip of ['0.0.0.0', '51.38.1.2', '172.32.0.1', '172.15.0.1', '::', '::1', '', 'localhost', '8.8.8.8']) {
    assert.equal(relais.adresseAutorisee(ip), false, ip);
  }
});

test('lecture de la configuration : valeurs par défaut et ports invalides', () => {
  assert.deepEqual(relais.lireConfig({}), {
    ecouteIp: '172.17.0.1', ecoutePort: 8642, cibleIp: '127.0.0.1', ciblePort: 8642,
  });
  const c = relais.lireConfig({ RELAIS_IP: ' 172.18.0.1 ', RELAIS_PORT: 'abc', CIBLE_PORT: '70000' });
  assert.equal(c.ecouteIp, '172.18.0.1');
  assert.equal(c.ecoutePort, 8642);
  assert.equal(c.ciblePort, 8642);
});

test('refuse une adresse publique et une boucle sur lui-même', () => {
  assert.throws(() => relais.demarrerRelais({ ecouteIp: '0.0.0.0', ecoutePort: 1, cibleIp: '127.0.0.1', ciblePort: 2 }), /refusée/);
  assert.throws(() => relais.demarrerRelais({ ecouteIp: '127.0.0.1', ecoutePort: 5, cibleIp: '127.0.0.1', ciblePort: 5 }), /identiques/);
});

test('recopie une vraie requête HTTP vers la cible (comme l\'API Hermès)', async (t) => {
  const portCible = await portLibre();
  const portRelais = await portLibre();
  const cible = http.createServer((req, res) => {
    let corps = '';
    req.on('data', (d) => { corps += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ chemin: req.url, auth: req.headers.authorization, corps }));
    });
  });
  await new Promise((r) => cible.listen(portCible, '127.0.0.1', r));
  t.after(() => cible.close());

  const serveur = await new Promise((resolve) => {
    relais.demarrerRelais({ ecouteIp: '127.0.0.1', ecoutePort: portRelais, cibleIp: '127.0.0.1', ciblePort: portCible }, resolve);
  });
  t.after(() => serveur.close());

  const rep = await fetch(`http://127.0.0.1:${portRelais}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer cle-test', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'hermes-agent', messages: [{ role: 'user', content: 'Bonjour' }] }),
  });
  assert.equal(rep.status, 200);
  const json = await rep.json();
  assert.equal(json.chemin, '/v1/chat/completions');
  assert.equal(json.auth, 'Bearer cle-test');
  assert.match(json.corps, /Bonjour/);
});

test('cible arrêtée : la connexion du client est fermée proprement', async (t) => {
  const portCible = await portLibre(); // personne n'écoute
  const portRelais = await portLibre();
  const serveur = await new Promise((resolve) => {
    relais.demarrerRelais({ ecouteIp: '127.0.0.1', ecoutePort: portRelais, cibleIp: '127.0.0.1', ciblePort: portCible }, resolve);
  });
  t.after(() => serveur.close());
  const ferme = await new Promise((resolve) => {
    const c = net.connect(portRelais, '127.0.0.1');
    c.on('error', () => {});
    c.on('close', () => resolve(true));
    setTimeout(() => resolve(false), 3000).unref();
  });
  assert.equal(ferme, true);
});

test('lancé comme dans docker-compose (variables RELAIS_*), puis arrêté par SIGTERM', async (t) => {
  const portCible = await portLibre();
  const portRelais = await portLibre();
  const cible = net.createServer((s) => s.end('pong'));
  await new Promise((r) => cible.listen(portCible, '127.0.0.1', r));
  t.after(() => cible.close());

  const enfant = spawn(process.execPath, [path.join(DEPLOY, 'hermes', 'relais-hermes.js')], {
    env: { RELAIS_IP: '127.0.0.1', RELAIS_PORT: String(portRelais), CIBLE_IP: '127.0.0.1', CIBLE_PORT: String(portCible) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let sortie = '';
  enfant.stdout.on('data', (d) => { sortie += d; });
  await new Promise((resolve, reject) => {
    const minuteur = setTimeout(() => reject(new Error(`relais pas prêt : ${sortie}`)), 5000);
    enfant.stdout.on('data', () => { if (/prêt/.test(sortie)) { clearTimeout(minuteur); resolve(); } });
  });
  const recu = await new Promise((resolve, reject) => {
    const c = net.connect(portRelais, '127.0.0.1');
    let d = '';
    c.on('data', (x) => { d += x; });
    c.on('end', () => resolve(d));
    c.on('error', reject);
  });
  assert.equal(recu, 'pong');
  const code = await new Promise((resolve) => { enfant.on('exit', resolve); enfant.kill('SIGTERM'); });
  assert.equal(code, 0);
});

test('adresse publique dans RELAIS_IP : le relais refuse de démarrer (code 1)', async () => {
  const enfant = spawn(process.execPath, [path.join(DEPLOY, 'hermes', 'relais-hermes.js')], {
    env: { RELAIS_IP: '0.0.0.0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let sortie = '';
  enfant.stdout.on('data', (d) => { sortie += d; });
  const code = await new Promise((resolve) => enfant.on('exit', resolve));
  assert.equal(code, 1);
  assert.match(sortie, /refusée/);
});
