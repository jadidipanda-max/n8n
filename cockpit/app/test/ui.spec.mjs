// Tests de l'interface du cockpit : Playwright (sans @playwright/test) piloté par node:test.
// Lancer depuis cockpit/app :  node --test test/ui.spec.mjs   (ou : node test/ui.spec.mjs)
// - Playwright : module « playwright », sinon /opt/node-tools/node_modules/playwright (ou PLAYWRIGHT_MODULE).
// - supabase-js 2.45.4 (UMD) : SUPABASE_JS_UMD, sinon cockpit/app/node_modules, sinon un cache dans le dossier
//   temporaire (installé une fois avec npm). Le vrai fichier est servi à la place de cdn.jsdelivr.net.
// - Captures d'écran : dossier UI_CAPTURES (par défaut <tmp>/cockpit-ui-captures).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ICI, '..', 'public');
const require = createRequire(import.meta.url);
const { construireCsp, SUPABASE_JS_URL } = require('../server.js');
const CAPTURES = process.env.UI_CAPTURES || path.join(os.tmpdir(), 'cockpit-ui-captures');
const SUPABASE_VERSION = '2.45.4';
const FAUX = 'https://faux-projet.supabase.co';
const CLE = 'sb_publishable_test_cockpit';
const XSS = '<img src=x onerror=alert(1)>';
const norm = s => String(s || '').replace(/[\s  ]/g, '');

/* ---------- dépendances ---------- */
async function chargerPlaywright() {
  for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return await import(m); } catch { /* suivant */ }
  }
  return null;
}
function umdValide(fichier) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fichier), '..', '..', 'package.json'), 'utf8'));
    return fs.statSync(fichier).size > 50000 && pkg.version === SUPABASE_VERSION;
  } catch { return false; }
}
function trouverSupabaseUmd() {
  if (process.env.SUPABASE_JS_UMD && fs.existsSync(process.env.SUPABASE_JS_UMD)) return process.env.SUPABASE_JS_UMD;
  const rel = path.join('node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
  const cache = path.join(os.tmpdir(), `cockpit-ui-supabase-js-${SUPABASE_VERSION}`);
  for (const c of [path.join(ICI, '..', rel), path.join(cache, rel)]) if (umdValide(c)) return c;
  try {
    fs.mkdirSync(cache, { recursive: true });
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', `@supabase/supabase-js@${SUPABASE_VERSION}`, '--prefix', cache], { stdio: 'ignore', timeout: 180000 });
  } catch { /* hors ligne */ }
  return umdValide(path.join(cache, rel)) ? path.join(cache, rel) : null;
}

/* ---------- petit serveur statique de test (+ /api/config) ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
function demarrerServeur() {
  const etat = { config: { supabaseUrl: null, supabasePublishableKey: null, hermes: false, demo: true } };
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://test.local');
    // même CSP que server.js : le moindre script en ligne serait bloqué
    res.setHeader('Content-Security-Policy', construireCsp(etat.config.supabaseUrl || ''));
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (url.pathname === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(etat.config));
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Pas de Hermès sur le serveur de test.' }));
    }
    const nom = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const fichier = path.join(PUBLIC, nom);
    if (!fichier.startsWith(PUBLIC + path.sep) || !fs.existsSync(fichier) || !fs.statSync(fichier).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('introuvable');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(fichier).pipe(res);
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve({ srv, etat, base: `http://127.0.0.1:${srv.address().port}` })));
}

/* ---------- jeux de données pour le faux Supabase ---------- */
const JAY = '11111111-1111-4111-8111-111111111111';
const JUNIOR = '22222222-2222-4222-8222-222222222222';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub, email) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.signature-de-test`;

function donneesPleines() {
  const now = new Date();
  const ilYa = min => new Date(now.getTime() - min * 60000).toISOString();
  const dans = j => new Date(now.getTime() + j * 86400000).toISOString();
  const mois = (k) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1)); return d.toISOString().slice(0, 10); };
  return {
    v_cash_resume: [
      { marche: 'fr', devise: 'EUR', cash_mois: 1234, cash_mois_eur: 1234, cumul: 4321, cumul_eur: 4321, premier_paiement: mois(-1), mrr: 900, mrr_eur: 900, objectif_cash: 5000, objectif_clients: 6, clients_signes_mois: 2 },
      { marche: 'us', devise: 'USD', cash_mois: 2000, cash_mois_eur: 1782, cumul: 2000, cumul_eur: 1782, premier_paiement: mois(0), mrr: 497, mrr_eur: 442.83, objectif_cash: 4000, objectif_clients: 6, clients_signes_mois: 1 },
      { marche: 'total', devise: 'EUR', cash_mois: 3016, cash_mois_eur: 3016, cumul: 6103, cumul_eur: 6103, premier_paiement: mois(-1), mrr: 1342.83, mrr_eur: 1342.83, objectif_cash: 8564, objectif_clients: 12, clients_signes_mois: 3 },
    ],
    v_cash_attendu: [1, 2, 3].flatMap(k => [
      { marche: 'fr', mois: mois(k), devise: 'EUR', engage: 900, probable: k === 3 ? 300 : 0, engage_eur: 900, probable_eur: k === 3 ? 300 : 0 },
      { marche: 'us', mois: mois(k), devise: 'USD', engage: 497, probable: 0, engage_eur: 442.83, probable_eur: 0 },
      { marche: 'total', mois: mois(k), devise: 'EUR', engage: 1342.83, probable: k === 3 ? 300 : 0, engage_eur: 1342.83, probable_eur: k === 3 ? 300 : 0 },
    ]),
    v_cash_cumul: [
      { marche: 'fr', jour: mois(-1), cumul: 3087, cumul_eur: 3087 }, { marche: 'fr', jour: mois(0), cumul: 4321, cumul_eur: 4321 },
      { marche: 'us', jour: mois(0), cumul: 2000, cumul_eur: 1782 },
      { marche: 'total', jour: mois(-1), cumul: 3087, cumul_eur: 3087 }, { marche: 'total', jour: mois(0), cumul: 6103, cumul_eur: 6103 },
    ],
    v_seuils: [{ annee: now.getUTCFullYear(), ca_france_eur: 4321, ca_total_eur: 6103, jours_activite: 153, jours_annee: 365, tva_base: 15719.18, tva_majore: 17291.1, plafond_micro: 35043.29, alerte_tva: 'ok', alerte_micro: 'ok' }],
    v_partage: [
      { periode: 'mois', debut: mois(0), fin: mois(1), cash_eur: 3016, cotisations_eur: 772.1, couts_eur: 65, resultat_eur: 2178.9, part_jay_eur: 1089.45, part_junior_eur: 1089.45 },
      { periode: 'annee', debut: `${now.getUTCFullYear()}-01-01`, fin: mois(1), cash_eur: 6103, cotisations_eur: 1562.37, couts_eur: 75, resultat_eur: 4465.63, part_jay_eur: 2232.82, part_junior_eur: 2232.81 },
    ],
    profils: [{ id: JAY, nom: 'Jay', role: 'admin', marche: 'fr' }],
    clients: [
      { id: 'cli-1', marche: 'fr', nom: `${XSS}Client piégé`, niche: 'Esthétique', palier: 'Pilote', prix_mensuel: 190, devise: 'EUR', mise_en_place: 0, debut: mois(0), fin_engagement: mois(3), objectif_garantie: 'demandes qualifiées', objectif_valeur: 30, resultat_valeur: 12, prochain_point: dans(5), point_booke: true, statut: 'actif', owner_id: JAY },
      { id: 'cli-2', marche: 'us', nom: 'Sunrise Med Spa', niche: 'Med spa', palier: 'Starter', prix_mensuel: 497, devise: 'USD', mise_en_place: 500, debut: mois(0), fin_engagement: mois(3), objectif_garantie: 'consultations', objectif_valeur: 24, resultat_valeur: 3, prochain_point: dans(8), point_booke: false, statut: 'actif', owner_id: JUNIOR },
    ],
    actions: [
      { id: 'act-1', marche: 'fr', agent: 'finance', type_action: 'preparer_facture', titre: 'Facture 2026-030 · Client test · 190 €', details: {}, statut: 'en_attente', auto: false, cree_le: ilYa(30) },
      { id: 'act-2', marche: 'us', agent: 'paperasse', type_action: 'envoyer_proposition', titre: `Proposition ${XSS}`, details: {}, statut: 'en_attente', auto: false, cree_le: ilYa(20) },
    ],
    autonomie: [
      { agent: 'finance', type_action: 'preparer_facture', niveau: 1, verrou: false, ok_consecutifs: 4 },
      { agent: 'finance', type_action: 'changer_prix', niveau: 0, verrou: true, ok_consecutifs: 0 },
      { agent: 'paperasse', type_action: 'envoyer_proposition', niveau: 0, verrou: false, ok_consecutifs: 0 },
    ],
    messages: [
      { id: 'msg-1', auteur: 'hermes', auteur_id: null, marche: null, type: 'rapport', contenu: 'Rapport du jour\n- Cash du mois : 3 016 €.', meta: {}, cree_le: ilYa(600) },
      { id: 'msg-2', auteur: 'hermes', auteur_id: null, marche: 'fr', type: 'message', contenu: XSS, meta: {}, cree_le: ilYa(5) },
    ],
    rapports: [{ jour: mois(0), verdict: 'tenir', resume: 'Tenir le cap.', contenu: 'Tout va bien.', donnees: { demos_total: 4, demos_necessaires: 20 }, cree_le: ilYa(600) }],
    agents_etat: [
      { agent: 'hermes', nom: 'Hermès', marche: null, statut: 'ok', derniere_phrase: 'Rapport envoyé.', derniere_execution: ilYa(600), prochaine_execution: null, cout_jour_eur: 0.5 },
      { agent: 'finance', nom: 'Finance', marche: null, statut: 'run', derniere_phrase: `<script>alert(2)</script>Calcul du mois`, derniere_execution: ilYa(3), prochaine_execution: null, cout_jour_eur: 0.2 },
    ],
    journal: [
      { id: 'jr-1', marche: 'fr', agent: 'finance', texte: `Objectif recalculé ${XSS}`, cree_le: ilYa(2) },
      { id: 'jr-2', marche: null, agent: 'hermes', texte: 'Rapport envoyé à Jay et Junior.', cree_le: ilYa(600) },
    ],
    objectifs: [
      { mois: mois(0), marche: 'fr', clients_vises: 6, cash_vise: 5000, devise: 'EUR', calcule_par: 'finance' },
      { mois: mois(0), marche: 'us', clients_vises: 6, cash_vise: 4000, devise: 'USD', calcule_par: 'finance' },
    ],
    appels: [
      { id: 'ap-1', marche: 'fr', ecran: 'standard', lead_ref: 'std-1', statut: 'a_appeler', note: null, rappel_le: null, maj: ilYa(3000) },
      { id: 'ap-2', marche: 'fr', ecran: 'standard', lead_ref: 'std-2', statut: 'joint', note: null, rappel_le: null, maj: ilYa(10) },
      { id: 'ap-3', marche: 'fr', ecran: 'standard', lead_ref: 'Institut Test', statut: 'demo', note: null, rappel_le: dans(2), maj: ilYa(15) },
      { id: 'ap-4', marche: 'us', ecran: 'us_floride', lead_ref: 'fl-1', statut: 'a_appeler', note: null, rappel_le: null, maj: ilYa(3000) },
    ],
  };
}

function donneesVides() {
  const z = m => ({ marche: m, devise: m === 'us' ? 'USD' : 'EUR', cash_mois: 0, cash_mois_eur: 0, cumul: 0, cumul_eur: 0, premier_paiement: null, mrr: 0, mrr_eur: 0, objectif_cash: null, objectif_clients: 6, clients_signes_mois: 0 });
  return {
    v_cash_resume: [z('fr'), z('us'), { ...z('total'), objectif_clients: 12 }], v_cash_attendu: [], v_cash_cumul: [], v_seuils: [], v_partage: [],
    profils: [{ id: JAY, nom: 'Jay', role: 'admin', marche: 'fr' }], clients: [], actions: [], autonomie: [], messages: [], rapports: [],
    agents_etat: [], journal: [], objectifs: [], appels: [],
  };
}

/* ---------- faux Supabase : REST, Auth et Realtime interceptés ---------- */
async function brancherFauxSupabase(page, donnees, compte = { id: JAY, email: 'jay@exemple.fr' }) {
  const fx = { donnees, requetes: [], rpc: [], chat: [], ws: null, topic: null, liaisons: [], jeton: jwt(compte.id, compte.email), compte };
  const session = () => ({
    access_token: fx.jeton, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'rafraichir-test',
    user: { id: compte.id, aud: 'authenticated', role: 'authenticated', email: compte.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-08-01T00:00:00Z' },
  });
  await page.route(`${FAUX}/**`, async route => {
    const req = route.request(), u = new URL(req.url()), origine = req.headers().origin || '*';
    const cors = { 'access-control-allow-origin': origine, 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer, range, x-supabase-api-version', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'access-control-expose-headers': 'content-range' };
    const json = (status, corps, extra = {}) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: corps === undefined ? '' : JSON.stringify(corps) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let corps = null;
    try { corps = req.postData() ? JSON.parse(req.postData()) : null; } catch { corps = req.postData(); }
    const entree = { methode: req.method(), chemin: u.pathname, params: u.searchParams, entetes: req.headers(), corps };
    fx.requetes.push(entree);
    const p = u.pathname;
    if (p === '/auth/v1/token') {
      if (u.searchParams.get('grant_type') === 'refresh_token') return json(200, session());
      if (corps && corps.email === compte.email && corps.password === 'bon-mot-de-passe') return json(200, session());
      return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    }
    if (p === '/auth/v1/user') return json(200, session().user);
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (p === '/auth/v1/recover') return json(200, {});
    if (p.startsWith('/rest/v1/rpc/')) {
      const nom = p.slice('/rest/v1/rpc/'.length);
      fx.rpc.push({ nom, corps, entetes: req.headers() });
      if (nom === 'decider_action') {
        const a = fx.donnees.actions.find(x => x.id === corps.p_id);
        if (!a) return json(400, { code: 'P0002', message: 'Action introuvable.' });
        a.statut = corps.p_ok ? 'validee' : 'refusee';
        return json(200, { ...a });
      }
      if (nom === 'changer_autonomie') return json(200, { agent: corps.p_agent, type_action: corps.p_type, niveau: corps.p_niveau, verrou: false, ok_consecutifs: 0 });
      return json(404, { message: 'fonction inconnue' });
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.slice('/rest/v1/'.length);
      let rows = fx.donnees[table];
      if (!rows) return json(404, { code: '42P01', message: `relation ${table} inconnue` });
      if (table === 'actions') rows = rows.filter(a => a.statut === 'en_attente');
      if (table === 'profils') rows = rows.filter(r => r.id === compte.id);
      return json(200, rows, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/*` });
    }
    return json(404, { message: 'inconnu' });
  });
  await page.routeWebSocket(/faux-projet\.supabase\.co\/realtime\/v1\/websocket/, ws => {
    fx.ws = ws;
    ws.onMessage(brut => {
      let m; try { m = JSON.parse(String(brut)); } catch { return; }
      if (m.event === 'phx_join') {
        fx.topic = m.topic;
        fx.liaisons = ((m.payload.config && m.payload.config.postgres_changes) || []).map((f, i) => ({ id: 100 + i, event: f.event, schema: f.schema, table: f.table, ...(f.filter ? { filter: f.filter } : {}) }));
        ws.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: fx.liaisons } }, ref: m.ref, join_ref: m.join_ref }));
      } else if (m.ref) {
        ws.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: m.ref, join_ref: m.join_ref }));
      }
    });
  });
  // messagerie : on vérifie l'appel au serveur du cockpit, sans Hermès réel
  await page.route('**/api/hermes/chat', async route => {
    const req = route.request();
    fx.chat.push({ entetes: req.headers(), corps: JSON.parse(req.postData() || '{}') });
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reply: 'Bien reçu, Jay. Le cash du mois est à jour.', messageId: 'msg-reponse-1' }) });
  });
  fx.pousser = (table, type, record) => {
    const l = fx.liaisons.find(x => x.table === table);
    assert.ok(l && fx.ws, `pas d'abonnement temps réel pour ${table}`);
    fx.ws.send(JSON.stringify({ topic: fx.topic, event: 'postgres_changes', payload: { ids: [l.id], data: { schema: 'public', table, commit_timestamp: new Date().toISOString(), type, columns: [], record, old_record: null, errors: null } }, ref: null }));
  };
  return fx;
}

/* ---------- outils ---------- */
let pw = null, navigateur = null, serveur = null, umd = null;

async function nouvellePage({ largeur = 1440, hauteur = 1000, theme = 'light', mouvement = 'no-preference' } = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, colorScheme: theme, reducedMotion: mouvement, timezoneId: 'Europe/Paris', locale: 'fr-FR' });
  const page = await ctx.newPage();
  const soucis = [];
  page.on('pageerror', e => soucis.push(`erreur de page : ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) soucis.push(`console : ${m.text()}`); });
  page.on('dialog', d => { soucis.push(`boîte de dialogue inattendue : ${d.message()}`); d.dismiss().catch(() => {}); });
  const jsdelivr = [];
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, headers: { 'content-type': 'text/css' }, body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.route('https://cdn.jsdelivr.net/**', r => {
    jsdelivr.push(r.request().url());
    if (r.request().url() === SUPABASE_JS_URL && umd) return r.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(umd, 'utf8') });
    return r.abort();
  });
  return { ctx, page, soucis, jsdelivr };
}
const debordement = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const capture = (page, nom, pleine = true) => page.screenshot({ path: path.join(CAPTURES, nom + '.png'), fullPage: pleine });
const texte = (page, sel) => page.locator(sel).first().textContent();
async function attendreCash(page, attendu) {
  await page.waitForFunction(v => {
    const el = document.querySelector('#cashBig');
    return !!el && el.textContent.replace(/[\s  ]/g, '') === v;
  }, attendu, { timeout: 8000 });
}
// Attend que l'interface ait placé le curseur dans le champ, puis remplit (évite toute course
// entre le placement du curseur et la saisie de Playwright).
async function attendreCurseur(page, sel) {
  await page.waitForFunction(id => document.activeElement && document.activeElement.id === id, sel.slice(1), { timeout: 8000 });
}
async function remplirConnexion(page, email, mdp) {
  await page.waitForSelector('#loginForm:not([hidden])');
  await attendreCurseur(page, '#loginEmail');
  await page.fill('#loginEmail', email);
  await page.fill('#loginPassword', mdp);
  assert.equal(await page.inputValue('#loginEmail'), email, 'e-mail saisi dans le bon champ');
  assert.equal(await page.inputValue('#loginPassword'), mdp, 'mot de passe saisi dans le bon champ');
}
async function attendreApp(page) {
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#plan .room').length === 8 && !!document.querySelector('#core'));
}

before(async () => {
  pw = await chargerPlaywright();
  if (!pw) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  umd = trouverSupabaseUmd();
  navigateur = await pw.chromium.launch();
  serveur = await demarrerServeur();
});
after(async () => {
  if (navigateur) await navigateur.close();
  if (serveur) serveur.srv.close();
});
const sansPlaywright = () => (pw ? false : 'Playwright introuvable (PLAYWRIGHT_MODULE)');
const sansSupabase = () => sansPlaywright() || (umd ? false : `supabase-js ${SUPABASE_VERSION} introuvable (SUPABASE_JS_UMD ou npm hors ligne)`);

/* =====================================================================
   1. Mode démo : 1440 px et 390 px, clair et sombre
   ===================================================================== */
for (const largeur of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`démo ${largeur} px, thème ${theme === 'light' ? 'clair' : 'sombre'} : rendu sans débordement ni erreur`, async t => {
      if (sansPlaywright()) return t.skip(sansPlaywright());
      serveur.etat.config = { supabaseUrl: null, supabasePublishableKey: null, hermes: false, demo: true };
      const { ctx, page, soucis, jsdelivr } = await nouvellePage({ largeur, hauteur: largeur > 500 ? 1000 : 844, theme });
      try {
        await page.goto(serveur.base + '/#qg');
        await attendreApp(page);
        assert.equal(await page.locator('#demoBanner').isVisible(), true, 'le bandeau « Données d’exemple » doit être visible');
        assert.match(await texte(page, '#demoBanner'), /Données d’exemple/);
        assert.equal(await page.locator('#logout').isVisible(), false, 'pas de déconnexion en démo');
        const fond = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        assert.equal(fond, theme === 'light' ? 'rgb(236, 239, 244)' : 'rgb(7, 12, 22)', 'jetons de couleur du thème');
        await attendreCash(page, '3628€');
        if (largeur > 1080) assert.ok(await page.locator('#conduits line.flow').count() >= 8, 'conduits dessinés sur grand écran');
        for (const st of ['qg', 'fr', 'us']) {
          await page.click(`#tab-${st}`);
          await page.waitForFunction(s => document.querySelector(`#tab-${s}`).getAttribute('aria-selected') === 'true' && document.querySelectorAll('#plan .room').length === 8, st);
          await page.waitForTimeout(700);
          assert.ok(await debordement(page) <= 0, `débordement horizontal en station ${st}`);
          await capture(page, `demo-${largeur}-${theme}-${st}`);
        }
        await attendreCash(page, '997$');
        // carrousel du cash : 3 écrans
        await page.click('.seg button[data-go="2"]');
        await page.waitForFunction(() => document.querySelector('.seg button[data-go="2"]').getAttribute('aria-current') === 'true');
        await page.click('.seg button[data-go="0"]');
        // salle ouverte et messagerie
        await page.click('#tab-fr');
        await page.click('.room[data-room="valider"] .room-name');
        await page.waitForSelector('#panel:not([hidden]) .decision');
        assert.ok(await debordement(page) <= 0, 'débordement avec le panneau ouvert');
        await page.waitForTimeout(450); // fin de l'animation d'ouverture
        await capture(page, `demo-${largeur}-${theme}-panneau`, false);
        await page.keyboard.press('Escape');
        await page.click('#openChat');
        await page.waitForSelector('#chat .msg');
        await page.waitForTimeout(450); // fin de l'animation d'ouverture
        await capture(page, `demo-${largeur}-${theme}-hermes`, false);
        assert.deepEqual(jsdelivr, [], 'en démo, supabase-js ne doit pas être chargé');
        assert.deepEqual(soucis, []);
      } finally { await ctx.close(); }
    });
  }
}

test('démo : décider une action et écrire à Hermès (données d’exemple)', async t => {
  if (sansPlaywright()) return t.skip(sansPlaywright());
  serveur.etat.config = { supabaseUrl: null, supabasePublishableKey: null, hermes: false, demo: true };
  const { ctx, page, soucis } = await nouvellePage({ mouvement: 'reduce' });
  try {
    await page.goto(serveur.base + '/#fr');
    await attendreApp(page);
    await attendreCash(page, '2740€');
    const avant = Number(norm(await texte(page, '.room[data-room="valider"] .bignum')).replace(/\D.*/, ''));
    assert.equal(avant, 3);
    await page.click('.room[data-room="valider"] [data-ok]');
    await page.waitForFunction(() => /^2/.test(document.querySelector('.room[data-room="valider"] .bignum').textContent.trim()));
    await page.click('#openChat');
    await page.fill('#chatInput', 'Bonjour Hermès');
    await page.press('#chatInput', 'Enter');
    await page.waitForFunction(() => /Mode démo/.test(document.querySelector('#chat').textContent));
    assert.match(await texte(page, '#chat'), /Bonjour Hermès/);
    assert.deepEqual(soucis, []);
  } finally { await ctx.close(); }
});

test('démo forcée avec ?demo quand Supabase est configuré', async t => {
  if (sansPlaywright()) return t.skip(sansPlaywright());
  serveur.etat.config = { supabaseUrl: FAUX, supabasePublishableKey: CLE, hermes: true, demo: false };
  const { ctx, page, soucis, jsdelivr } = await nouvellePage({ largeur: 390, hauteur: 844 });
  try {
    await page.goto(serveur.base + '/?demo#qg');
    await attendreApp(page);
    assert.equal(await page.locator('#demoBanner').isVisible(), true);
    assert.equal(await page.locator('#leaveDemo').isVisible(), true, 'lien « Quitter la démo »');
    assert.deepEqual(jsdelivr, []);
    assert.deepEqual(soucis, []);
  } finally { await ctx.close(); }
});

/* =====================================================================
   2. Mode Supabase : réseau intercepté vers une fausse URL Supabase
   ===================================================================== */
test('Supabase : connexion, montants des vues, décision, temps réel, Hermès, XSS, déconnexion', async t => {
  if (sansSupabase()) return t.skip(sansSupabase());
  serveur.etat.config = { supabaseUrl: FAUX, supabasePublishableKey: CLE, hermes: true, demo: false };
  const { ctx, page, soucis, jsdelivr } = await nouvellePage({ mouvement: 'reduce' });
  const fx = await brancherFauxSupabase(page, donneesPleines());
  try {
    await page.goto(serveur.base + '/');
    await page.waitForSelector('#loginForm:not([hidden])');
    assert.deepEqual(jsdelivr, [SUPABASE_JS_URL], 'supabase-js chargé depuis la version figée du contrat');
    await capture(page, 'supabase-connexion');

    // erreurs claires en français
    await page.click('#loginSubmit');
    assert.match(await texte(page, '#loginError'), /Indique ton adresse e-mail/);
    await remplirConnexion(page, 'jay@exemple.fr', 'mauvais');
    await page.click('#loginSubmit');
    await page.waitForFunction(() => /incorrect/.test(document.querySelector('#loginError').textContent));
    assert.match(await texte(page, '#loginError'), /E-mail ou mot de passe incorrect/);
    await capture(page, 'supabase-connexion-erreur');

    // connexion réussie : Jay (admin) arrive au QG
    await page.fill('#loginPassword', 'bon-mot-de-passe');
    await page.click('#loginSubmit');
    await attendreApp(page);
    assert.equal(await page.getAttribute('#tab-qg', 'aria-selected'), 'true');
    assert.equal(await page.locator('#demoBanner').isVisible(), false, 'pas de bandeau démo avec Supabase');
    await attendreCash(page, '3016€');
    assert.match(norm(await texte(page, '.core-line')), /France1234€/);
    assert.match(norm(await texte(page, '.core-line')), /USA2000\$/);

    // les vues et tables du contrat ont été lues, avec la clé publishable et le jeton
    const lues = new Set(fx.requetes.filter(r => r.chemin.startsWith('/rest/v1/') && !r.chemin.includes('/rpc/')).map(r => r.chemin.slice(9)));
    for (const nom of ['profils', 'v_cash_resume', 'v_cash_attendu', 'v_cash_cumul', 'v_seuils', 'v_partage', 'clients', 'actions', 'autonomie', 'messages', 'rapports', 'agents_etat', 'journal', 'objectifs', 'appels']) {
      assert.ok(lues.has(nom), `lecture de ${nom}`);
    }
    const rest = fx.requetes.filter(r => r.chemin.startsWith('/rest/v1/'));
    assert.ok(rest.every(r => r.entetes.apikey === CLE && r.entetes.authorization === `Bearer ${fx.jeton}`), 'apikey et jeton sur chaque lecture');
    const lecture = nom => fx.requetes.find(r => r.chemin === `/rest/v1/${nom}`);
    assert.equal(lecture('actions').params.get('statut'), 'eq.en_attente');
    assert.equal(lecture('messages').params.get('limit'), '50');
    assert.equal(lecture('journal').params.get('limit'), '30');
    assert.equal(lecture('rapports').params.get('limit'), '1');

    // montants par station
    await page.click('#tab-fr');
    await attendreCash(page, '1234€');
    await page.click('#tab-us');
    await attendreCash(page, '2000$');
    await page.click('#tab-qg');
    await attendreCash(page, '3016€');
    await page.waitForTimeout(300);
    await capture(page, 'supabase-qg');

    // XSS : le texte de la base s'affiche comme du texte
    assert.equal(await page.locator('img').count(), 0, 'aucune image injectée');
    assert.equal(await page.locator('#plan script, #journal script').count(), 0);

    // OK sur une action → rpc/decider_action
    await page.click('.room[data-room="valider"] [data-ok="act-1"]');
    await page.waitForFunction(() => !document.querySelector('.room[data-room="valider"] [data-ok="act-1"]'));
    const dec = fx.rpc.find(r => r.nom === 'decider_action');
    assert.ok(dec, 'appel à rpc/decider_action');
    assert.deepEqual(dec.corps, { p_id: 'act-1', p_ok: true, p_correction: null });
    assert.equal(dec.entetes.authorization, `Bearer ${fx.jeton}`);

    // temps réel : un paiement arrive, les chiffres se rafraîchissent
    await page.waitForFunction(() => /En direct/.test(document.querySelector('#journalStatus').textContent), null, { timeout: 8000 });
    assert.deepEqual(fx.liaisons.map(l => l.table).sort(), ['actions', 'agents_etat', 'journal', 'messages', 'paiements']);
    fx.donnees.v_cash_resume = fx.donnees.v_cash_resume.map(r => (r.marche === 'fr' ? { ...r, cash_mois: 2234, cash_mois_eur: 2234 } : r.marche === 'total' ? { ...r, cash_mois: 4016, cash_mois_eur: 4016 } : r));
    fx.pousser('paiements', 'INSERT', { id: 'pay-9', marche: 'fr', type: 'abonnement', montant: 1000, devise: 'EUR', paye_le: new Date().toISOString() });
    await attendreCash(page, '4016€');
    await page.waitForFunction(() => /Paiement reçu/.test(document.querySelector('#toasts').textContent));

    // messagerie : le contenu piégé reste du texte, l'envoi passe par /api/hermes/chat avec le jeton
    await page.click('#openChat');
    await page.waitForSelector('#chat .msg');
    assert.ok((await texte(page, '#chat')).includes(XSS), 'le contenu piégé est affiché tel quel');
    assert.equal(await page.locator('#chat img').count(), 0);
    await page.fill('#chatInput', 'Bonjour Hermès, où en est le cash ?');
    await page.click('#composer button[type="submit"]');
    await page.waitForFunction(() => /Bien reçu, Jay/.test(document.querySelector('#chat').textContent));
    assert.equal(fx.chat.length, 1);
    assert.equal(fx.chat[0].entetes.authorization, `Bearer ${fx.jeton}`);
    assert.deepEqual(fx.chat[0].corps, { message: 'Bonjour Hermès, où en est le cash ?', marche: null });
    await page.waitForTimeout(450);
    await capture(page, 'supabase-hermes', false);
    // le message renvoyé par le temps réel ne crée pas de doublon
    fx.pousser('messages', 'INSERT', { id: 'msg-moi-1', auteur: 'jay', auteur_id: JAY, marche: null, type: 'message', contenu: 'Bonjour Hermès, où en est le cash ?', meta: {}, cree_le: new Date().toISOString() });
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#chat .msg.me').count(), 1, 'un seul exemplaire du message envoyé');
    await page.keyboard.press('Escape');

    // niveaux d'autonomie : modifiables par l'admin → rpc/changer_autonomie
    await page.click('.room[data-room="finance"] .room-name');
    await page.waitForSelector('#panel:not([hidden]) .auto-row');
    assert.equal(await page.locator('#panel [data-type="changer_prix"][data-lvl="2"]').isDisabled(), true, 'action verrouillée');
    await page.click('#panel [data-type="preparer_facture"][data-lvl="2"]');
    await page.waitForFunction(() => document.querySelector('#panel [data-type="preparer_facture"][data-lvl="2"]').getAttribute('aria-pressed') === 'true');
    assert.deepEqual(fx.rpc.find(r => r.nom === 'changer_autonomie').corps, { p_agent: 'finance', p_type: 'preparer_facture', p_niveau: 2 });
    await page.waitForTimeout(450);
    await capture(page, 'supabase-finance', false);
    await page.keyboard.press('Escape');

    // déconnexion
    await page.click('#logout');
    await page.waitForSelector('#loginForm:not([hidden])');
    assert.ok(fx.requetes.some(r => r.chemin === '/auth/v1/logout'), 'appel de déconnexion');
    assert.match(await texte(page, '#loginInfo'), /déconnecté/);

    // mot de passe oublié
    await page.click('#forgotLink');
    await attendreCurseur(page, '#forgotEmail');
    await page.fill('#forgotEmail', 'jay@exemple.fr');
    await page.click('#forgotSubmit');
    await page.waitForSelector('#forgotOk:not([hidden])');
    const rec = fx.requetes.find(r => r.chemin === '/auth/v1/recover');
    assert.equal(rec.corps.email, 'jay@exemple.fr');
    // seul le refus volontaire du mauvais mot de passe (400) apparaît dans la console
    assert.equal(soucis.filter(s => /status of 400/.test(s)).length, 1);
    assert.deepEqual(soucis.filter(s => !/status of 400/.test(s)), []);
  } finally { await ctx.close(); }
});

test('Supabase : Junior (associé) arrive à la station USA et ne change pas l’autonomie', async t => {
  if (sansSupabase()) return t.skip(sansSupabase());
  serveur.etat.config = { supabaseUrl: FAUX, supabasePublishableKey: CLE, hermes: true, demo: false };
  const { ctx, page, soucis } = await nouvellePage({ largeur: 390, hauteur: 844, theme: 'dark', mouvement: 'reduce' });
  const d = donneesPleines();
  d.profils = [{ id: JUNIOR, nom: 'Junior', role: 'associe', marche: 'us' }];
  const fx = await brancherFauxSupabase(page, d, { id: JUNIOR, email: 'junior@exemple.com' });
  try {
    await page.goto(serveur.base + '/');
    await remplirConnexion(page, 'junior@exemple.com', 'bon-mot-de-passe');
    await page.click('#loginSubmit');
    await attendreApp(page);
    assert.equal(await page.getAttribute('#tab-us', 'aria-selected'), 'true', 'Junior arrive à la station USA');
    await attendreCash(page, '2000$');
    assert.ok(await debordement(page) <= 0);
    await capture(page, 'supabase-junior-us-390-sombre');
    // une action France ne peut pas être décidée par Junior
    await page.click('#tab-qg');
    await page.waitForSelector('.room[data-room="valider"] [data-ok="act-1"]');
    assert.equal(await page.locator('.room[data-room="valider"] [data-ok="act-1"]').isDisabled(), true);
    assert.equal(await page.locator('.room[data-room="valider"] [data-ok="act-2"]').isDisabled(), false);
    await page.click('.room[data-room="finance"] .room-name');
    await page.waitForSelector('#panel:not([hidden]) .auto-row');
    assert.equal(await page.locator('#panel .chip-btn[data-lvl]:not([disabled])').count(), 0, 'niveaux en lecture seule');
    assert.match(await texte(page, '#panel'), /Seul Jay \(admin\) peut changer ces niveaux/);
    assert.ok(await debordement(page) <= 0);
    assert.equal(fx.rpc.length, 0);
    assert.deepEqual(soucis, []);
  } finally { await ctx.close(); }
});

test('Supabase : base vide → 0 € et explication, sans fausses données', async t => {
  if (sansSupabase()) return t.skip(sansSupabase());
  serveur.etat.config = { supabaseUrl: FAUX, supabasePublishableKey: CLE, hermes: false, demo: false };
  const { ctx, page, soucis } = await nouvellePage({ mouvement: 'reduce' });
  await brancherFauxSupabase(page, donneesVides());
  try {
    await page.goto(serveur.base + '/');
    await remplirConnexion(page, 'jay@exemple.fr', 'bon-mot-de-passe');
    await page.click('#loginSubmit');
    await attendreApp(page);
    await attendreCash(page, '0€');
    const explication = await texte(page, '#cashVide');
    assert.match(explication, /Stripe/);
    assert.match(explication, /n8n/);
    const tout = await page.evaluate(() => document.body.innerText);
    for (const faux of ['Institut Aurore', 'Maison Solène', 'Glow Aesthetics', '3 628']) assert.ok(!tout.includes(faux), `donnée d’exemple affichée : ${faux}`);
    assert.equal(await page.locator('#demoBanner').isVisible(), false);
    await capture(page, 'supabase-vide-qg');
    await page.click('#tab-fr');
    await attendreCash(page, '0€');
    await capture(page, 'supabase-vide-fr');
    await page.click('#openChat');
    assert.equal(await page.locator('#chatInput').isDisabled(), true, 'Hermès pas branché : envoi désactivé');
    assert.match(await texte(page, '#panel'), /pas encore branché/);
    assert.deepEqual(soucis, []);
  } finally { await ctx.close(); }
});

test('Supabase : lien « mot de passe oublié » → nouveau mot de passe, puis entrée', async t => {
  if (sansSupabase()) return t.skip(sansSupabase());
  serveur.etat.config = { supabaseUrl: FAUX, supabasePublishableKey: CLE, hermes: true, demo: false };
  const { ctx, page, soucis } = await nouvellePage({ largeur: 390, hauteur: 844, mouvement: 'reduce' });
  const fx = await brancherFauxSupabase(page, donneesPleines());
  try {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await page.goto(`${serveur.base}/#access_token=${fx.jeton}&expires_at=${exp}&expires_in=3600&refresh_token=rafraichir-test&token_type=bearer&type=recovery`);
    await page.waitForSelector('#recoverForm:not([hidden])');
    await attendreCurseur(page, '#newPassword');
    await page.fill('#newPassword', 'nouveau-mdp-2026');
    await page.fill('#newPassword2', 'autre-chose-2026');
    await page.click('#recoverSubmit');
    assert.match(await texte(page, '#recoverError'), /pas identiques/);
    await page.fill('#newPassword2', 'nouveau-mdp-2026');
    await page.click('#recoverSubmit');
    await attendreApp(page);
    const maj = fx.requetes.find(r => r.chemin === '/auth/v1/user' && r.methode === 'PUT');
    assert.ok(maj, 'appel updateUser');
    assert.equal(maj.corps.password, 'nouveau-mdp-2026');
    assert.ok(!page.url().includes('access_token'), 'le jeton ne reste pas dans l’adresse');
    assert.deepEqual(soucis, []);
  } finally { await ctx.close(); }
});

test('Supabase : compte sans profil → message clair et déconnexion possible', async t => {
  if (sansSupabase()) return t.skip(sansSupabase());
  serveur.etat.config = { supabaseUrl: FAUX, supabasePublishableKey: CLE, hermes: true, demo: false };
  const { ctx, page, soucis } = await nouvellePage({ mouvement: 'reduce' });
  const d = donneesPleines();
  d.profils = [];
  const fx = await brancherFauxSupabase(page, d);
  try {
    await page.goto(serveur.base + '/');
    await remplirConnexion(page, 'jay@exemple.fr', 'bon-mot-de-passe');
    await page.click('#loginSubmit');
    await page.waitForSelector('#fatal:not([hidden])');
    assert.match(await texte(page, '#fatalTitle'), /pas encore accès/);
    assert.ok(!fx.requetes.some(r => r.chemin === '/rest/v1/v_cash_resume'), 'aucune donnée lue sans profil');
    await page.click('#fatalLogout');
    await page.waitForSelector('#loginForm:not([hidden])');
    assert.deepEqual(soucis, []);
  } finally { await ctx.close(); }
});

/* =====================================================================
   Régressions : curseur de connexion et CSP
   ===================================================================== */
test('connexion : le curseur ne quitte pas le mot de passe pendant la saisie (pas de course)', async t => {
  if (sansSupabase()) return t.skip(sansSupabase());
  serveur.etat.config = { supabaseUrl: FAUX, supabasePublishableKey: CLE, hermes: true, demo: false };
  const { ctx, page } = await nouvellePage({ mouvement: 'reduce' });
  await brancherFauxSupabase(page, donneesPleines());
  try {
    // horloge figée : les minuteurs de l'interface ne tournent que quand on avance l'horloge
    await page.clock.install({ time: new Date('2026-10-04T10:00:00+02:00') });
    await page.clock.pauseAt(new Date('2026-10-04T10:00:01+02:00'));
    await page.goto(serveur.base + '/');
    await page.waitForSelector('#loginForm:not([hidden])');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'loginEmail', 'curseur placé tout de suite');
    await page.fill('#loginEmail', 'junior@exemple.com');
    await page.focus('#loginPassword');
    await page.keyboard.type('bon-');
    await page.clock.runFor(1000); // le minuteur de placement du curseur passe pendant la saisie
    await page.keyboard.type('mot-de-passe');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'loginPassword');
    assert.equal(await page.inputValue('#loginEmail'), 'junior@exemple.com');
    assert.equal(await page.inputValue('#loginPassword'), 'bon-mot-de-passe');
  } finally { await ctx.close(); }
});

test('CSP : un script d’un autre chemin de jsDelivr est bloqué par le navigateur', async t => {
  if (sansPlaywright()) return t.skip(sansPlaywright());
  serveur.etat.config = { supabaseUrl: null, supabasePublishableKey: null, hermes: false, demo: true };
  const { ctx, page } = await nouvellePage({ mouvement: 'reduce' });
  const servis = [];
  // si le navigateur laissait passer, ce faux « code tiers » s'exécuterait
  await page.route('https://cdn.jsdelivr.net/gh/**', r => { servis.push(r.request().url()); return r.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: 'window.__tiers = "code tiers exécuté";' }); });
  try {
    await page.goto(serveur.base + '/?demo#qg');
    await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
    const resultat = await page.evaluate(() => new Promise(resolve => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', e => violations.push(e.blockedURI));
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/gh/attaquant/outil@1/x.js';
      s.onload = () => resolve({ etat: 'chargé', tiers: window.__tiers || null, violations });
      s.onerror = () => setTimeout(() => resolve({ etat: 'bloqué', tiers: window.__tiers || null, violations }), 50);
      document.head.appendChild(s);
    }));
    assert.equal(resultat.etat, 'bloqué');
    assert.equal(resultat.tiers, null);
    assert.ok(resultat.violations.some(u => u.startsWith('https://cdn.jsdelivr.net/gh/')), JSON.stringify(resultat.violations));
    assert.deepEqual(servis, [], 'aucune requête n’est partie vers le chemin interdit');
  } finally { await ctx.close(); }
});
