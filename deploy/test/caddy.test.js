'use strict';
// Test réel du Caddyfile : le vrai binaire Caddy devant le vrai serveur du cockpit (mode démo)
// et un faux n8n. Seules différences avec la production : certificats locaux (pas de Let's Encrypt),
// ports libres au lieu de 80/443, et 127.0.0.1 au lieu des noms de conteneurs.
// Il tourne si CADDY_BIN pointe vers le binaire caddy (ou si « caddy » est dans le PATH).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn, spawnSync } = require('node:child_process');
const { DEPLOY, RACINE, binaire, dossierTemp, portLibre } = require('./outils');

const CADDY = binaire('CADDY_BIN', 'caddy');
const sansCaddy = CADDY ? false : 'binaire caddy absent (CADDY_BIN)';
const DOMAINE = 'jsquare.test';

function attendre(condition, delaiMs, message) {
  const fin = Date.now() + delaiMs;
  return new Promise((resolve, reject) => {
    const essai = async () => {
      try {
        if (await condition()) return resolve();
      } catch { /* pas encore prêt */ }
      if (Date.now() > fin) return reject(new Error(message));
      setTimeout(essai, 100);
    };
    essai();
  });
}

function requete({ port, hote, chemin = '/', tls = true, enTetes = {} }) {
  const module_ = tls ? https : http;
  return new Promise((resolve, reject) => {
    const req = module_.request({
      host: '127.0.0.1', port, path: chemin, method: 'GET', servername: hote,
      headers: { host: hote, ...enTetes }, rejectUnauthorized: false,
    }, (res) => {
      const morceaux = [];
      res.on('data', (d) => morceaux.push(d));
      res.on('end', () => {
        let corps = Buffer.concat(morceaux);
        if (res.headers['content-encoding'] === 'gzip') corps = zlib.gunzipSync(corps);
        resolve({ statut: res.statusCode, enTetes: res.headers, corps: corps.toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('caddy validate accepte le Caddyfile de production', { skip: sansCaddy }, () => {
  const r = spawnSync(CADDY, ['validate', '--config', path.join(DEPLOY, 'Caddyfile'), '--adapter', 'caddyfile'], {
    encoding: 'utf8', env: { ...process.env, DOMAINE, EMAIL_ACME: 'jay@jsquare.test' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout + r.stderr, /Valid configuration/);
  const f = spawnSync(CADDY, ['fmt', '--diff', path.join(DEPLOY, 'Caddyfile')], { encoding: 'utf8' });
  assert.doesNotMatch(f.stdout, /^[-+]/m, 'le Caddyfile doit être au format de « caddy fmt »');
});

test('Caddy devant le cockpit et n8n : HTTPS, redirection, en-têtes, compression', { skip: sansCaddy, timeout: 60_000 }, async (t) => {
  const dossier = dossierTemp('caddy');
  const [portCockpit, portN8n, portHttp, portHttps] = await Promise.all([portLibre(), portLibre(), portLibre(), portLibre()]);
  const processus = [];
  t.after(() => {
    for (const p of processus) p.kill('SIGTERM');
    fs.rmSync(dossier, { recursive: true, force: true });
  });

  // Le vrai cockpit, lancé comme dans docker-compose (node server.js, PORT), en mode démo.
  const cockpit = spawn(process.execPath, ['server.js'], {
    cwd: path.join(RACINE, 'cockpit', 'app'),
    env: { PATH: process.env.PATH, PORT: String(portCockpit), DEMO: '1' },
    stdio: 'ignore',
  });
  processus.push(cockpit);

  // Faux n8n : répond sans en-têtes de sécurité, sauf /xfo qui pose son propre X-Frame-Options.
  const n8n = http.createServer((req, res) => {
    if (req.url === '/xfo') res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Powered-By', 'Express');
    res.end(`n8n ${req.url} ${req.headers['x-forwarded-proto']}`);
  });
  await new Promise((r) => n8n.listen(portN8n, '127.0.0.1', r));
  t.after(() => n8n.close());

  // Caddyfile de production, avec seulement les réglages de test listés en tête de fichier.
  const production = fs.readFileSync(path.join(DEPLOY, 'Caddyfile'), 'utf8');
  const globalProd = '{\n\temail {$EMAIL_ACME}\n}';
  assert.ok(production.includes(globalProd));
  const essai = production
    .replace(globalProd, `{\n\temail {$EMAIL_ACME}\n\tlocal_certs\n\tskip_install_trust\n\tadmin off\n\thttp_port ${portHttp}\n\thttps_port ${portHttps}\n}`)
    .replace('reverse_proxy cockpit:{$COCKPIT_PORT:8080}', 'reverse_proxy 127.0.0.1:{$COCKPIT_PORT:8080}')
    .replace('reverse_proxy n8n:5678', `reverse_proxy 127.0.0.1:${portN8n}`);
  const fichier = path.join(dossier, 'Caddyfile');
  fs.writeFileSync(fichier, essai);

  const caddy = spawn(CADDY, ['run', '--config', fichier, '--adapter', 'caddyfile'], {
    env: {
      PATH: process.env.PATH, HOME: dossier, XDG_DATA_HOME: path.join(dossier, 'data'), XDG_CONFIG_HOME: path.join(dossier, 'config'),
      DOMAINE, EMAIL_ACME: 'jay@jsquare.test', COCKPIT_PORT: String(portCockpit),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let journalCaddy = '';
  caddy.stderr.on('data', (d) => { journalCaddy += d; });
  processus.push(caddy);

  await attendre(async () => (await requete({ port: portCockpit, hote: 'x', tls: false, chemin: '/healthz' })).statut === 200,
    10_000, 'le cockpit ne démarre pas');
  await attendre(async () => (await requete({ port: portHttps, hote: `cockpit.${DOMAINE}`, chemin: '/healthz' })).statut === 200,
    30_000, `Caddy ne répond pas en HTTPS :\n${journalCaddy.slice(-2000)}`);

  // Cockpit : santé, configuration publique, en-têtes du cockpit gardés, ceux de Caddy ajoutés.
  const sante = await requete({ port: portHttps, hote: `cockpit.${DOMAINE}`, chemin: '/healthz' });
  assert.deepEqual(JSON.parse(sante.corps), { ok: true });
  assert.equal(sante.enTetes['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  assert.equal(sante.enTetes['x-content-type-options'], 'nosniff');
  assert.equal(sante.enTetes['x-frame-options'], 'DENY');
  assert.equal(sante.enTetes['referrer-policy'], 'same-origin', 'la politique du cockpit n\'est pas écrasée');
  assert.match(sante.enTetes['content-security-policy'], /script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
  assert.match(sante.enTetes['permissions-policy'], /camera=\(\)/);
  assert.equal(sante.enTetes.server, undefined, 'pas d\'en-tête Server');
  assert.equal(sante.enTetes.via, undefined, 'l\'en-tête Via (1.1 Caddy) est retiré');

  const config = await requete({ port: portHttps, hote: `cockpit.${DOMAINE}`, chemin: '/api/config' });
  assert.equal(config.statut, 200);
  assert.equal(JSON.parse(config.corps).demo, true);

  const page = await requete({ port: portHttps, hote: `cockpit.${DOMAINE}`, chemin: '/', enTetes: { 'accept-encoding': 'gzip' } });
  assert.equal(page.statut, 200);
  assert.equal(page.enTetes['content-encoding'], 'gzip');
  assert.match(page.corps, /<html/i);

  // n8n : proxifié en HTTPS, en-têtes posés seulement s'ils manquent, X-Powered-By retiré.
  const accueil = await requete({ port: portHttps, hote: `n8n.${DOMAINE}`, chemin: '/' });
  assert.equal(accueil.statut, 200);
  assert.equal(accueil.corps, 'n8n / https');
  assert.equal(accueil.enTetes['x-frame-options'], 'SAMEORIGIN');
  assert.equal(accueil.enTetes['x-powered-by'], undefined);
  assert.equal(accueil.enTetes.via, undefined);
  // n8n n'envoie rien : ce sont les valeurs de Caddy qui s'appliquent.
  assert.equal(accueil.enTetes['x-content-type-options'], 'nosniff');
  assert.equal(accueil.enTetes['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(accueil.enTetes['permissions-policy'], 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  assert.equal(accueil.enTetes['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  const xfo = await requete({ port: portHttps, hote: `n8n.${DOMAINE}`, chemin: '/xfo' });
  assert.equal(xfo.enTetes['x-frame-options'], 'DENY');

  // HTTP : redirection permanente vers HTTPS.
  const redirection = await requete({ port: portHttp, hote: `cockpit.${DOMAINE}`, chemin: '/', tls: false });
  assert.equal(redirection.statut, 308);
  assert.match(redirection.enTetes.location, new RegExp(`^https://cockpit\\.${DOMAINE.replace('.', '\\.')}`));
});
