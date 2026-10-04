'use strict';
// Tests du serveur du cockpit : faux Supabase et faux Hermès sur des ports locaux.
// Lancer avec : node --test (depuis cockpit/app)

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { creerServeur, construireCsp, lireConfig, creerQuota, MESSAGE_502_HERMES } = require('../server.js');

const PUB = 'sb_publishable_test_cle_publique';
const SECRET = 'sb_secret_test_cle_secrete_123';
const HERMES_KEY = 'hermes_cle_api_test_456';
const JAY = { id: '11111111-1111-4111-8111-111111111111', nom: 'Jay', role: 'admin', marche: 'fr' };
const JUNIOR = { id: '22222222-2222-4222-8222-222222222222', nom: 'Junior', role: 'associe', marche: 'us' };
const SANS_PROFIL = '33333333-3333-4333-8333-333333333333';
const JETONS = {
  'jeton.jay.valide': JAY.id,
  'jeton.junior.valide': JUNIOR.id,
  'jeton.sans.profil': SANS_PROFIL,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- outils ----------

function lireTout(req) {
  return new Promise((resolve, reject) => {
    const morceaux = [];
    req.on('data', (m) => morceaux.push(m));
    req.on('end', () => resolve(Buffer.concat(morceaux).toString('utf8')));
    req.on('error', reject);
  });
}

async function ouvrir(serveur) {
  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${serveur.address().port}`;
}

async function fermer(serveur) {
  serveur.closeAllConnections();
  await new Promise((resolve) => serveur.close(() => resolve()));
}

// Requête brute : le chemin part tel quel, sans normalisation du client.
function requeteBrute(base, chemin, methode = 'GET', enTetes = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: chemin, method: methode, headers: enTetes }, (res) => {
      let corps = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (corps += c));
      res.on('end', () => resolve({ statut: res.statusCode, corps, enTetes: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function chat(base, { jeton, corps, brut, autorisation } = {}) {
  const enTetes = { 'Content-Type': 'application/json' };
  if (autorisation) enTetes.Authorization = autorisation;
  else if (jeton) enTetes.Authorization = `Bearer ${jeton}`;
  const rep = await fetch(`${base}/api/hermes/chat`, {
    method: 'POST',
    headers: enTetes,
    body: brut !== undefined ? brut : JSON.stringify(corps),
  });
  const texte = await rep.text();
  let json = null;
  try {
    json = JSON.parse(texte);
  } catch {
    json = null;
  }
  return { statut: rep.status, json, texte, enTetes: rep.headers };
}

// ---------- faux Supabase (Auth + PostgREST, RLS simulée sur messages) ----------

function creerFauxSupabase() {
  const profils = new Map([
    [JAY.id, JAY],
    [JUNIOR.id, JUNIOR],
  ]);
  const etat = { messages: [], requetes: [], panneLecture: false };
  const serveur = http.createServer(async (req, res) => {
    const corps = await lireTout(req);
    const url = new URL(req.url, 'http://supabase.local');
    etat.requetes.push({ methode: req.method, chemin: url.pathname, recherche: url.search, enTetes: req.headers, corps });
    const envoyer = (statut, donnees) => {
      res.writeHead(statut, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(donnees));
    };
    const auth = req.headers.authorization || '';
    const jeton = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const uid = jeton ? JETONS[jeton] : undefined;
    const estSecret = req.headers.apikey === SECRET;
    if (!estSecret && req.headers.apikey !== PUB) return envoyer(401, { message: 'Invalid API key' });

    if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
      if (req.headers.apikey !== PUB || !uid) return envoyer(401, { code: 401, msg: 'invalid JWT' });
      return envoyer(200, { id: uid, aud: 'authenticated', email: 'test@exemple.fr' });
    }
    if (!estSecret && !uid) return envoyer(401, { message: 'JWT invalide' });

    if (url.pathname === '/rest/v1/profils' && req.method === 'GET') {
      const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      const profil = profils.get(id);
      return envoyer(200, profil ? [profil] : []);
    }
    if (url.pathname === '/rest/v1/messages' && req.method === 'POST') {
      const ligne = JSON.parse(corps);
      if (!estSecret) {
        // RLS : auteur_id = auth.uid() et auteur 'jay' pour l'admin, 'junior' pour l'associé
        const profil = profils.get(uid);
        const attendu = profil && (profil.role === 'admin' ? 'jay' : 'junior');
        if (!profil || ligne.auteur_id !== uid || ligne.auteur !== attendu) {
          return envoyer(403, { code: '42501', message: 'new row violates row-level security policy' });
        }
      }
      const complete = {
        id: crypto.randomUUID(),
        auteur_id: null,
        marche: null,
        type: 'message',
        meta: {},
        cree_le: new Date().toISOString(),
        ...ligne,
      };
      etat.messages.push(complete);
      return envoyer(201, [complete]);
    }
    if (url.pathname === '/rest/v1/messages' && req.method === 'GET') {
      if (etat.panneLecture) return envoyer(500, { message: 'panne' });
      const limite = Number(url.searchParams.get('limit')) || 1000;
      return envoyer(200, etat.messages.slice().reverse().slice(0, limite));
    }
    return envoyer(404, { message: 'inconnu' });
  });
  return { serveur, etat };
}

// ---------- faux Hermès (API OpenAI-compatible) ----------

function creerFauxHermes() {
  const etat = { mode: 'ok', appels: [] };
  const serveur = http.createServer(async (req, res) => {
    const corps = await lireTout(req);
    let json = null;
    try {
      json = JSON.parse(corps);
    } catch {
      json = null;
    }
    etat.appels.push({ methode: req.method, chemin: req.url, enTetes: req.headers, corps: json });
    const envoyer = (statut, donnees) => {
      res.writeHead(statut, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(donnees));
    };
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return envoyer(404, { error: 'inconnu' });
    if (req.headers.authorization !== `Bearer ${HERMES_KEY}`) return envoyer(401, { error: { message: 'Invalid API key' } });
    if (etat.mode === 'panne') return envoyer(500, { error: { message: 'boom' } });
    if (etat.mode === 'muet') return; // ne répond jamais
    if (etat.mode === 'vide') return envoyer(200, { choices: [{ message: { role: 'assistant', content: '' } }] });
    return envoyer(200, {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: json && json.model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'Bonjour, ici Hermès.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  });
  return { serveur, etat };
}

// ---------- mise en place commune ----------

const journaux = [];
const consoleOrigine = { log: console.log, warn: console.warn, error: console.error, info: console.info };
const aFermer = [];
let supabase;
let hermes;
let urlSupabase;
let urlHermes;
let racineTemp;
let dossierPublic;

function envComplet(supplement = {}) {
  return {
    SUPABASE_URL: urlSupabase,
    SUPABASE_PUBLISHABLE_KEY: PUB,
    SUPABASE_SECRET_KEY: SECRET,
    HERMES_URL: urlHermes,
    HERMES_API_KEY: HERMES_KEY,
    ...supplement,
  };
}

async function nouveauCockpit(supplement = {}, options = {}) {
  const serveur = creerServeur({ env: envComplet(supplement), dossierPublic, ...options });
  aFermer.push(serveur);
  return ouvrir(serveur);
}

function messagesDe(auteur) {
  return supabase.etat.messages.filter((m) => m.auteur === auteur);
}

before(async () => {
  // On capture les journaux du serveur pour vérifier qu'aucun secret n'y passe.
  for (const nom of Object.keys(consoleOrigine)) {
    console[nom] = (...args) => journaux.push(args.map(String).join(' '));
  }
  supabase = creerFauxSupabase();
  hermes = creerFauxHermes();
  urlSupabase = await ouvrir(supabase.serveur);
  urlHermes = await ouvrir(hermes.serveur);

  racineTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-test-'));
  dossierPublic = path.join(racineTemp, 'public');
  fs.mkdirSync(path.join(dossierPublic, 'sous'), { recursive: true });
  fs.writeFileSync(path.join(dossierPublic, 'index.html'), '<!doctype html><title>Cockpit test</title><p>ACCUEIL</p>');
  fs.writeFileSync(path.join(dossierPublic, 'app.js'), "console.log('app');");
  fs.writeFileSync(path.join(dossierPublic, 'style.css'), 'body{color:black}');
  fs.writeFileSync(path.join(dossierPublic, 'sous', 'index.html'), '<p>SOUS-DOSSIER</p>');
  fs.writeFileSync(path.join(dossierPublic, '.env'), 'SECRET_DANS_PUBLIC');
  fs.writeFileSync(path.join(racineTemp, 'secret.txt'), 'SECRET_HORS_PUBLIC');
  fs.symlinkSync(path.join(racineTemp, 'secret.txt'), path.join(dossierPublic, 'fuite.txt'));
});

after(async () => {
  for (const serveur of aFermer) await fermer(serveur);
  await fermer(supabase.serveur);
  await fermer(hermes.serveur);
  fs.rmSync(racineTemp, { recursive: true, force: true });
  Object.assign(console, consoleOrigine);
});

// ---------- configuration et santé ----------

describe('configuration', () => {
  test('GET /api/config renvoie la config publique, sans aucun secret', async () => {
    const base = await nouveauCockpit();
    const rep = await fetch(`${base}/api/config`);
    assert.equal(rep.status, 200);
    assert.match(rep.headers.get('content-type'), /application\/json/);
    assert.equal(rep.headers.get('cache-control'), 'no-store');
    const texte = await rep.text();
    assert.deepEqual(JSON.parse(texte), {
      supabaseUrl: urlSupabase,
      supabasePublishableKey: PUB,
      hermes: true,
      demo: false,
    });
    assert.ok(!texte.includes(SECRET), 'la clé secrète Supabase ne doit jamais sortir');
    assert.ok(!texte.includes(HERMES_KEY), 'la clé Hermès ne doit jamais sortir');
  });

  test('DEMO=1 force le mode démo', async () => {
    const base = await nouveauCockpit({ DEMO: '1' });
    const json = await (await fetch(`${base}/api/config`)).json();
    assert.equal(json.demo, true);
  });

  test('sans HERMES_API_KEY, hermes vaut false', async () => {
    const base = await nouveauCockpit({ HERMES_API_KEY: '' });
    const json = await (await fetch(`${base}/api/config`)).json();
    assert.equal(json.hermes, false);
    assert.equal(json.demo, false);
  });

  test('sans SUPABASE_URL, le cockpit passe en démo', async () => {
    const base = await nouveauCockpit({ SUPABASE_URL: '' });
    const json = await (await fetch(`${base}/api/config`)).json();
    assert.equal(json.demo, true);
    assert.equal(json.supabaseUrl, null);
    assert.equal(json.hermes, false);
  });

  test('valeurs par défaut du contrat', () => {
    const config = lireConfig({});
    assert.equal(config.port, 8080);
    assert.equal(config.hermesUrl, 'http://host.docker.internal:8642');
    assert.equal(config.hermesModel, 'hermes-agent');
    assert.equal(config.demo, true);
    assert.equal(lireConfig({ PORT: '3000', SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_PUBLISHABLE_KEY: PUB }).port, 3000);
    assert.equal(lireConfig({ SUPABASE_URL: 'https://abc.supabase.co/' }).supabaseUrl, 'https://abc.supabase.co');
  });

  test('GET /healthz', async () => {
    const base = await nouveauCockpit();
    const rep = await fetch(`${base}/healthz`);
    assert.equal(rep.status, 200);
    assert.deepEqual(await rep.json(), { ok: true });
  });

  test('une adresse /api inconnue répond 404 en JSON', async () => {
    const base = await nouveauCockpit();
    const rep = await fetch(`${base}/api/inconnu`);
    assert.equal(rep.status, 404);
    assert.ok((await rep.json()).error);
  });
});

// ---------- fichiers statiques ----------

describe('fichiers statiques', () => {
  test('sert index.html, app.js et style.css avec le bon type', async () => {
    const base = await nouveauCockpit();
    let rep = await fetch(`${base}/`);
    assert.equal(rep.status, 200);
    assert.match(rep.headers.get('content-type'), /^text\/html/);
    assert.match(await rep.text(), /ACCUEIL/);

    rep = await fetch(`${base}/index.html?demo`);
    assert.equal(rep.status, 200);
    assert.match(await rep.text(), /ACCUEIL/);

    rep = await fetch(`${base}/app.js`);
    assert.equal(rep.status, 200);
    assert.match(rep.headers.get('content-type'), /^text\/javascript/);

    rep = await fetch(`${base}/style.css`);
    assert.equal(rep.status, 200);
    assert.match(rep.headers.get('content-type'), /^text\/css/);

    rep = await fetch(`${base}/sous/`);
    assert.equal(rep.status, 200);
    assert.match(await rep.text(), /SOUS-DOSSIER/);
  });

  test('HEAD et ETag (304)', async () => {
    const base = await nouveauCockpit();
    const tete = await requeteBrute(base, '/app.js', 'HEAD');
    assert.equal(tete.statut, 200);
    assert.equal(tete.corps, '');
    assert.ok(tete.enTetes.etag);
    const encore = await requeteBrute(base, '/app.js', 'GET', { 'If-None-Match': tete.enTetes.etag });
    assert.equal(encore.statut, 304);
  });

  test('aucune traversée de chemin ni fichier caché', async () => {
    const base = await nouveauCockpit();
    const tentatives = [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e%2fsecret.txt',
      '/%2E%2E%2Fsecret.txt',
      '/sous/../../secret.txt',
      '/sous/%2e%2e%2f%2e%2e%2fsecret.txt',
      '/..%5csecret.txt',
      '/%2e%2e%5csecret.txt',
      '/....//secret.txt',
      '/.env',
      '/%2eenv',
      '/sous/..%2f.env',
      '/fuite.txt',
      '/index.html%00.js',
      '/%2fetc%2fpasswd',
      '/..%2f..%2f..%2f..%2fetc%2fpasswd',
      '/../server.js',
      '/..%2fserver.js',
      '/%',
    ];
    for (const chemin of tentatives) {
      const rep = await requeteBrute(base, chemin);
      assert.ok([400, 404].includes(rep.statut), `${chemin} → ${rep.statut}`);
      assert.ok(!rep.corps.includes('SECRET_'), `${chemin} a laissé fuir un secret`);
      assert.ok(!rep.corps.includes('root:'), `${chemin} a laissé fuir /etc/passwd`);
      assert.ok(!rep.corps.includes('creerServeur'), `${chemin} a laissé fuir le code du serveur`);
    }
  });

  test('méthode autre que GET/HEAD refusée sur les fichiers', async () => {
    const base = await nouveauCockpit();
    const rep = await fetch(`${base}/index.html`, { method: 'POST', body: 'x' });
    assert.equal(rep.status, 405);
    assert.equal(rep.headers.get('allow'), 'GET, HEAD');
  });

  test('sans dossier public/, le serveur répond quand même', async () => {
    const base = await nouveauCockpit({}, { dossierPublic: path.join(racineTemp, 'absent') });
    const rep = await fetch(`${base}/`);
    assert.equal(rep.status, 404);
    assert.match(await rep.text(), /public/);
    const sante = await fetch(`${base}/healthz`);
    assert.equal(sante.status, 200);
  });
});

// ---------- en-têtes de sécurité ----------

describe('en-têtes de sécurité', () => {
  test('CSP stricte, X-Frame-Options, Referrer-Policy sur toutes les réponses', async () => {
    const base = await nouveauCockpit();
    const hote = new URL(urlSupabase).host;
    const reponses = [
      await fetch(`${base}/`),
      await fetch(`${base}/api/config`),
      await fetch(`${base}/healthz`),
      await fetch(`${base}/introuvable.html`),
      await fetch(`${base}/api/hermes/chat`, { method: 'POST', body: '{}' }),
    ];
    for (const rep of reponses) {
      const csp = rep.headers.get('content-security-policy');
      assert.ok(csp, `CSP absente sur ${rep.url}`);
      assert.equal(csp, construireCsp(urlSupabase));
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net(;|$)/);
      assert.ok(csp.includes(`connect-src 'self' http://${hote} ws://${hote}`));
      assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
      assert.match(csp, /style-src [^;]*https:\/\/fonts\.googleapis\.com/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /object-src 'none'/);
      const scripts = csp.split(';').find((d) => d.trim().startsWith('script-src'));
      assert.ok(!scripts.includes('unsafe'), 'aucun script inline ou eval autorisé');
      assert.equal(rep.headers.get('x-frame-options'), 'DENY');
      assert.equal(rep.headers.get('referrer-policy'), 'same-origin');
      assert.equal(rep.headers.get('x-content-type-options'), 'nosniff');
      await rep.arrayBuffer();
    }
  });

  test('CSP en production : Supabase en https et wss', () => {
    const csp = construireCsp('https://abcdefgh.supabase.co');
    assert.ok(csp.includes("connect-src 'self' https://abcdefgh.supabase.co wss://abcdefgh.supabase.co"));
    assert.ok(construireCsp('').includes("connect-src 'self';"));
  });
});

// ---------- messagerie Hermès ----------

describe('POST /api/hermes/chat', () => {
  test('405 en GET', async () => {
    const base = await nouveauCockpit();
    const rep = await fetch(`${base}/api/hermes/chat`);
    assert.equal(rep.status, 405);
    assert.equal(rep.headers.get('allow'), 'POST');
  });

  test('401 sans jeton, avec un jeton invalide ou mal formé', async () => {
    const base = await nouveauCockpit();
    const avantMessages = supabase.etat.messages.length;
    const avantHermes = hermes.etat.appels.length;
    const corps = { message: 'Salut', marche: 'fr' };

    let rep = await chat(base, { corps });
    assert.equal(rep.statut, 401);
    assert.ok(rep.json.error);

    rep = await chat(base, { jeton: 'jeton.inconnu.xyz', corps });
    assert.equal(rep.statut, 401);
    assert.match(rep.json.error, /reconnecte/);

    rep = await chat(base, { autorisation: 'Basic amF5OnNlY3JldA==', corps });
    assert.equal(rep.statut, 401);

    rep = await chat(base, { autorisation: 'Bearer ', corps });
    assert.equal(rep.statut, 401);

    assert.equal(supabase.etat.messages.length, avantMessages, 'aucun message enregistré');
    assert.equal(hermes.etat.appels.length, avantHermes, 'Hermès jamais appelé');
  });

  test('403 sans profil', async () => {
    const base = await nouveauCockpit();
    const avant = supabase.etat.messages.length;
    const rep = await chat(base, { jeton: 'jeton.sans.profil', corps: { message: 'Bonjour', marche: null } });
    assert.equal(rep.statut, 403);
    assert.match(rep.json.error, /profil/);
    assert.equal(supabase.etat.messages.length, avant);
  });

  test('400 pour un corps invalide ou trop long', async () => {
    const base = await nouveauCockpit();
    const avantMessages = supabase.etat.messages.length;
    const avantHermes = hermes.etat.appels.length;
    const jeton = 'jeton.jay.valide';
    const cas = [
      { brut: 'pas du json' },
      { brut: '' },
      { brut: '[]' },
      { brut: 'null' },
      { corps: {} },
      { corps: { message: 42 } },
      { corps: { message: '' } },
      { corps: { message: '   \n  ' } },
      { corps: { message: 'x'.repeat(4001) } },
      { corps: { message: '😀'.repeat(4001) } },
      { corps: { message: 'Bonjour', marche: 'de' } },
      { corps: { message: 'Bonjour', marche: 3 } },
      { corps: { message: 'a\u0000b' } },
      { brut: JSON.stringify({ message: 'x'.repeat(70 * 1024) }) },
    ];
    for (const c of cas) {
      const rep = await chat(base, { jeton, ...c });
      assert.equal(rep.statut, 400, `cas ${JSON.stringify(c).slice(0, 60)} → ${rep.statut}`);
      assert.ok(rep.json && typeof rep.json.error === 'string');
    }
    assert.equal(supabase.etat.messages.length, avantMessages, 'aucun message enregistré');
    assert.equal(hermes.etat.appels.length, avantHermes, 'Hermès jamais appelé');
  });

  test('Jay (admin) : message auteur "jay" avec son jeton, réponse Hermès avec la clé secrète', async () => {
    const base = await nouveauCockpit();
    const debutRequetes = supabase.etat.requetes.length;
    const debutHermes = hermes.etat.appels.length;

    const rep = await chat(base, { jeton: 'jeton.jay.valide', corps: { message: '  Où en est le cash ce mois-ci ?  ', marche: 'fr' } });
    assert.equal(rep.statut, 200, rep.texte);
    assert.equal(rep.json.reply, 'Bonjour, ici Hermès.');
    assert.match(rep.json.messageId, UUID);
    assert.deepEqual(Object.keys(rep.json).sort(), ['messageId', 'reply']);

    // Base : message de Jay puis réponse d'Hermès
    const deJay = messagesDe('jay').at(-1);
    assert.equal(deJay.auteur_id, JAY.id);
    assert.equal(deJay.marche, 'fr');
    assert.equal(deJay.type, 'message');
    assert.equal(deJay.contenu, 'Où en est le cash ce mois-ci ?');
    const deHermes = messagesDe('hermes').at(-1);
    assert.equal(deHermes.id, rep.json.messageId);
    assert.equal(deHermes.contenu, 'Bonjour, ici Hermès.');
    assert.equal(deHermes.marche, 'fr');
    assert.equal(deHermes.meta.en_reponse_a, deJay.id);

    // Requêtes Supabase : jeton de Jay pour lui, clé secrète pour Hermès
    const requetes = supabase.etat.requetes.slice(debutRequetes);
    const verif = requetes.find((r) => r.chemin === '/auth/v1/user');
    assert.equal(verif.enTetes.apikey, PUB);
    assert.equal(verif.enTetes.authorization, 'Bearer jeton.jay.valide');
    const profil = requetes.find((r) => r.chemin === '/rest/v1/profils');
    assert.match(profil.recherche, new RegExp(`id=eq\\.${JAY.id}`));
    assert.equal(profil.enTetes.authorization, 'Bearer jeton.jay.valide');
    const insertions = requetes.filter((r) => r.chemin === '/rest/v1/messages' && r.methode === 'POST');
    assert.equal(insertions.length, 2);
    const [insJay, insHermes] = insertions;
    assert.equal(JSON.parse(insJay.corps).auteur, 'jay');
    assert.equal(insJay.enTetes.apikey, PUB);
    assert.equal(insJay.enTetes.authorization, 'Bearer jeton.jay.valide');
    assert.match(insJay.enTetes.prefer, /return=representation/);
    assert.equal(JSON.parse(insHermes.corps).auteur, 'hermes');
    assert.equal(insHermes.enTetes.apikey, SECRET);
    assert.ok(!insHermes.enTetes.authorization, 'la clé sb_secret_ passe seulement dans apikey');
    const lecture = requetes.find((r) => r.chemin === '/rest/v1/messages' && r.methode === 'GET');
    assert.match(lecture.recherche, /limit=20/);
    assert.match(lecture.recherche, /order=cree_le\.desc/);
    assert.equal(lecture.enTetes.authorization, 'Bearer jeton.jay.valide');

    // Appel Hermès : endpoint OpenAI-compatible, clé API, modèle par défaut
    const appels = hermes.etat.appels.slice(debutHermes);
    assert.equal(appels.length, 1);
    const appel = appels[0];
    assert.equal(appel.chemin, '/v1/chat/completions');
    assert.equal(appel.enTetes.authorization, `Bearer ${HERMES_KEY}`);
    assert.equal(appel.corps.model, 'hermes-agent');
    assert.equal(appel.corps.stream, false);
    const systeme = appel.corps.messages[0];
    assert.equal(systeme.role, 'system');
    assert.match(systeme.content, /Jay/);
    assert.match(systeme.content, /France/);
    assert.match(systeme.content, /table actions/);
    const dernier = appel.corps.messages.at(-1);
    assert.deepEqual(dernier, { role: 'user', content: 'Jay : Où en est le cash ce mois-ci ?' });
    assert.ok(!JSON.stringify(appel.corps).includes('jeton.jay.valide'), 'le jeton ne part pas chez Hermès');
  });

  test('Junior (associé) : message auteur "junior", historique partagé envoyé à Hermès', async () => {
    const base = await nouveauCockpit();
    const debutHermes = hermes.etat.appels.length;
    const rep = await chat(base, { jeton: 'jeton.junior.valide', corps: { message: 'How many US clients this month?', marche: 'us' } });
    assert.equal(rep.statut, 200, rep.texte);
    const deJunior = messagesDe('junior').at(-1);
    assert.equal(deJunior.auteur_id, JUNIOR.id);
    assert.equal(deJunior.marche, 'us');
    assert.equal(deJunior.contenu, 'How many US clients this month?');
    assert.equal(messagesDe('hermes').at(-1).id, rep.json.messageId);

    const appel = hermes.etat.appels.slice(debutHermes)[0];
    assert.match(appel.corps.messages[0].content, /Junior/);
    assert.match(appel.corps.messages[0].content, /USA/);
    const roles = appel.corps.messages.map((m) => m.role);
    assert.ok(roles.includes('assistant'), 'les réponses précédentes d’Hermès sont dans l’historique');
    assert.ok(appel.corps.messages.some((m) => m.role === 'user' && m.content.startsWith('Jay : ')), 'les messages de Jay sont nommés');
    assert.ok(appel.corps.messages.length <= 22, 'système + 20 messages au plus + message en cours');
    assert.deepEqual(appel.corps.messages.at(-1), { role: 'user', content: 'Junior : How many US clients this month?' });
  });

  test('HERMES_MODEL et HERMES_URL (barre finale) sont respectés', async () => {
    const base = await nouveauCockpit({ HERMES_MODEL: 'centre', HERMES_URL: `${urlHermes}/` });
    const debutHermes = hermes.etat.appels.length;
    const rep = await chat(base, { jeton: 'jeton.jay.valide', corps: { message: 'Test modèle' } });
    assert.equal(rep.statut, 200, rep.texte);
    const appel = hermes.etat.appels.slice(debutHermes)[0];
    assert.equal(appel.chemin, '/v1/chat/completions');
    assert.equal(appel.corps.model, 'centre');
    // marche absent = QG
    assert.equal(messagesDe('jay').at(-1).marche, null);
  });

  test('si la lecture de l’historique échoue, Hermès répond quand même', async () => {
    const base = await nouveauCockpit();
    supabase.etat.panneLecture = true;
    try {
      const rep = await chat(base, { jeton: 'jeton.jay.valide', corps: { message: 'Sans historique' } });
      assert.equal(rep.statut, 200, rep.texte);
      const appel = hermes.etat.appels.at(-1);
      assert.equal(appel.corps.messages.length, 2);
      assert.equal(appel.corps.messages[1].content, 'Jay : Sans historique');
    } finally {
      supabase.etat.panneLecture = false;
    }
  });

  test('502 quand Hermès tombe : le message de la personne reste enregistré', async () => {
    const base = await nouveauCockpit();
    hermes.etat.mode = 'panne';
    try {
      const avantHermes = messagesDe('hermes').length;
      const rep = await chat(base, { jeton: 'jeton.jay.valide', corps: { message: 'Tu es là ?', marche: 'fr' } });
      assert.equal(rep.statut, 502);
      assert.equal(rep.json.error, MESSAGE_502_HERMES);
      assert.equal(rep.json.error, 'Hermès ne répond pas, réessaie dans un instant');
      assert.equal(messagesDe('jay').at(-1).contenu, 'Tu es là ?');
      assert.equal(messagesDe('hermes').length, avantHermes, 'aucune réponse d’Hermès enregistrée');

      hermes.etat.mode = 'vide';
      const vide = await chat(base, { jeton: 'jeton.jay.valide', corps: { message: 'Réponse vide ?' } });
      assert.equal(vide.statut, 502);
      assert.equal(messagesDe('jay').at(-1).contenu, 'Réponse vide ?');
    } finally {
      hermes.etat.mode = 'ok';
    }
  });

  test('502 quand Hermès est injoignable, trop lent, ou refuse la clé', async () => {
    // Port fermé
    const ferme = http.createServer();
    const urlFermee = await ouvrir(ferme);
    await fermer(ferme);
    let base = await nouveauCockpit({ HERMES_URL: urlFermee });
    let rep = await chat(base, { jeton: 'jeton.junior.valide', corps: { message: 'Injoignable', marche: 'us' } });
    assert.equal(rep.statut, 502);
    assert.equal(rep.json.error, MESSAGE_502_HERMES);
    assert.equal(messagesDe('junior').at(-1).contenu, 'Injoignable');

    // Trop lent
    hermes.etat.mode = 'muet';
    try {
      base = await nouveauCockpit({}, { delaiHermesMs: 300 });
      rep = await chat(base, { jeton: 'jeton.junior.valide', corps: { message: 'Trop lent', marche: 'us' } });
      assert.equal(rep.statut, 502);
      assert.equal(messagesDe('junior').at(-1).contenu, 'Trop lent');
    } finally {
      hermes.etat.mode = 'ok';
    }

    // Mauvaise clé
    base = await nouveauCockpit({ HERMES_API_KEY: 'mauvaise_cle_hermes' });
    rep = await chat(base, { jeton: 'jeton.junior.valide', corps: { message: 'Mauvaise clé', marche: 'us' } });
    assert.equal(rep.statut, 502);
  });

  test('503 sans HERMES_API_KEY, avant tout appel à Supabase', async () => {
    const base = await nouveauCockpit({ HERMES_API_KEY: '' });
    const avantRequetes = supabase.etat.requetes.length;
    const avantMessages = supabase.etat.messages.length;
    const rep = await chat(base, { jeton: 'jeton.jay.valide', corps: { message: 'Hermès ?' } });
    assert.equal(rep.statut, 503);
    assert.match(rep.json.error, /HERMES_API_KEY/);
    assert.equal(supabase.etat.requetes.length, avantRequetes);
    assert.equal(supabase.etat.messages.length, avantMessages);
  });

  test('429 au-delà de 20 messages par minute et par personne', async () => {
    const base = await nouveauCockpit();
    for (let i = 1; i <= 20; i += 1) {
      const rep = await chat(base, { jeton: 'jeton.jay.valide', corps: { message: `Message ${i}` } });
      assert.equal(rep.statut, 200, `message ${i} → ${rep.statut}`);
    }
    const avant = supabase.etat.messages.length;
    const bloque = await chat(base, { jeton: 'jeton.jay.valide', corps: { message: 'Message 21' } });
    assert.equal(bloque.statut, 429);
    assert.ok(Number(bloque.enTetes.get('retry-after')) >= 1);
    assert.match(bloque.json.error, /minute/);
    assert.equal(supabase.etat.messages.length, avant, 'le 21e message n’est pas enregistré');

    // Junior n'est pas bloqué par le quota de Jay
    const autre = await chat(base, { jeton: 'jeton.junior.valide', corps: { message: 'Moi aussi', marche: 'us' } });
    assert.equal(autre.statut, 200);
  });

  test('le quota se libère après une minute', () => {
    const accepter = creerQuota(20, 60_000);
    for (let i = 0; i < 20; i += 1) assert.equal(accepter('a', 1000 + i).ok, true);
    assert.equal(accepter('a', 2000).ok, false);
    assert.equal(accepter('b', 2000).ok, true);
    assert.equal(accepter('a', 61_001).ok, true);
  });
});

// ---------- journaux ----------

test('les journaux du serveur ne contiennent ni jeton ni clé', () => {
  const tout = journaux.join('\n');
  assert.ok(journaux.length > 0, 'les journaux ont bien été capturés');
  assert.match(tout, /Hermès ne répond pas/);
  for (const secret of [SECRET, HERMES_KEY, PUB, 'mauvaise_cle_hermes', ...Object.keys(JETONS), 'jeton.inconnu.xyz']) {
    assert.ok(!tout.includes(secret), `secret trouvé dans les journaux : ${secret.slice(0, 6)}…`);
  }
});
