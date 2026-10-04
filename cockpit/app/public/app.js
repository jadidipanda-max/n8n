/* Tour de contrôle J-Square : connexion, couche de données (Supabase ou démo) et rendu.
   Le design vient de la maquette cockpit/tour-de-controle.html.
   Règle : tout texte venu de la base passe par esc() avant d'entrer dans le HTML. */
(() => {
'use strict';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
const TABLES_TEMPS_REEL = ['paiements', 'actions', 'messages', 'journal', 'agents_etat'];
const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const TZ = { fr: 'Europe/Paris', us: 'America/New_York', qg: 'Europe/Paris' };
const CUR = { fr: 'EUR', us: 'USD', qg: 'EUR' };
const APPELS_JOUR = 100; // objectif d'appels par jour et par marché (cahier des charges)
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pct = (a, b) => Math.max(0, Math.min(100, b ? a / b * 100 : 0));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get(k) { try { return window.localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
};

/* ---------- formats (montants et dates à l'heure du marché) ---------- */
const nfCache = {};
function money(v, cur = 'EUR', dec = 0) {
  const k = cur + dec;
  try {
    nfCache[k] = nfCache[k] || new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', minimumFractionDigits: dec, maximumFractionDigits: dec });
    return nfCache[k].format(dec ? num(v) : Math.round(num(v)));
  } catch { return `${Math.round(num(v))} ${String(cur).replace(/[^A-Za-z]/g, '').slice(0, 3)}`; }
}
const money2 = (v, cur = 'EUR') => money(v, cur, Number.isInteger(num(v)) ? 0 : 2);
const entier = v => Math.round(num(v)).toLocaleString('fr-FR');
const isDateOnly = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const toDate = s => s instanceof Date ? s : new Date(isDateOnly(s) ? s + 'T12:00:00Z' : s);
const ms = s => { const t = toDate(s).getTime(); return Number.isNaN(t) ? 0 : t; }; // tri fiable quel que soit le fuseau écrit
function fmt(s, o, tz) {
  if (!s) return '';
  const d = toDate(s);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', { ...o, timeZone: isDateOnly(s) ? 'UTC' : tz }).format(d);
}
const day = (s, tz) => fmt(s, { weekday: 'short', day: 'numeric', month: 'short' }, tz);
const dayShort = (s, tz) => fmt(s, { day: 'numeric', month: 'short' }, tz);
const hm = (s, tz) => fmt(s, { hour: '2-digit', minute: '2-digit' }, tz);
const ymd = (s, tz) => { const d = toDate(s); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: isDateOnly(s) ? 'UTC' : tz }).format(d); };
const clock = (tz, now) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(now);
function hourIn(tz, now) {
  const p = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: tz }).formatToParts(now);
  return +p.find(x => x.type === 'hour').value + (+p.find(x => x.type === 'minute').value) / 60;
}
// « il y a 3 min », « 09:12 », « hier 23:02 », « ce soir 23:00 »
function quand(ts, now, tz) {
  if (!ts) return '';
  const d = toDate(ts);
  if (Number.isNaN(d.getTime())) return '';
  const diff = (now - d) / 60000, jour = ymd(d, tz), auj = ymd(now, tz);
  if (diff < -1) {
    if (jour === auj) return (hourIn(tz, d) >= 18 ? 'ce soir ' : 'aujourd’hui ') + hm(d, tz);
    if (jour === ymd(new Date(now.getTime() + 86400000), tz)) return 'demain ' + hm(d, tz);
    return dayShort(d, tz) + ' ' + hm(d, tz);
  }
  if (diff < 1) return 'à l’instant';
  if (diff < 60) return `il y a ${Math.floor(diff)} min`;
  if (jour === auj) return hm(d, tz);
  if (jour === ymd(new Date(now.getTime() - 86400000), tz)) return 'hier ' + hm(d, tz);
  return dayShort(d, tz);
}
function heureMsg(ts, now, tz) {
  const d = toDate(ts);
  if (Number.isNaN(d.getTime())) return '';
  if (ymd(d, tz) === ymd(now, tz)) return hm(d, tz);
  if (ymd(d, tz) === ymd(new Date(now.getTime() - 86400000), tz)) return 'hier ' + hm(d, tz);
  return dayShort(d, tz) + ' ' + hm(d, tz);
}
function countdown(now) {
  const h = hourIn('Europe/Paris', now); let d = 23 - h; if (d <= 0) d += 24;
  let hh = Math.floor(d), mm = Math.round((d - hh) * 60);
  if (mm === 60) { hh += 1; mm = 0; }
  return `dans ${hh} h ${String(mm).padStart(2, '0')}`;
}

/* ---------- libellés ---------- */
const AGENT_NOM = { hermes: 'Hermès', prospection_fr: 'Prospection France', prospection_us: 'Prospection USA', finance: 'Finance', paperasse: 'Paperasse', reporter: 'Reporter', researcher: 'Recherche', suivi_clients: 'Suivi clients' };
const TYPES = {
  preparer_messages_facebook: ['Messages', 'Préparer les messages Facebook du jour'],
  mission_apify: ['Mission Apify', 'Lancer une mission de recherche de leads (Apify)'],
  preparer_proposition: ['Brouillon', 'Préparer un brouillon de proposition'],
  envoyer_proposition: ['Proposition', 'Envoyer une proposition au client'],
  relancer_offre: ['Relance', 'Relancer une offre sans réponse'],
  envoyer_contrat: ['Contrat', 'Envoyer un contrat au client'],
  signer_contrat: ['Contrat', 'Signer un contrat'],
  preparer_facture: ['Facture', 'Préparer une facture'],
  changer_prix: ['Prix', 'Changer un prix de la grille'],
  alerte_prix_plancher: ['Alerte prix', 'Lancer une alerte de prix plancher'],
  relance_impaye: ['Impayé', 'Relancer un impayé'],
  envoyer_argent: ['Argent', 'Envoyer de l’argent'],
  rembourser: ['Remboursement', 'Rembourser un client'],
  premier_message: ['1er message', 'Écrire à un client pour la première fois'],
  booker_point_mensuel: ['Agenda', 'Booker le point mensuel dans l’agenda'],
  envoyer_rapport_mensuel: ['Rapport client', 'Envoyer le rapport mensuel au client'],
  booker_demo: ['Démo', 'Booker une démo depuis l’écran d’appel'],
  deplacer_rdv_client: ['Agenda', 'Déplacer un rendez-vous client'],
  chercher_pistes: ['Recherche', 'Chercher et résumer des pistes'],
  changer_offre: ['Offre', 'Changer une offre ou un statut'],
  ecrire_rapport: ['Rapport', 'Écrire le rapport du soir'],
  changer_trajectoire: ['Trajectoire', 'Changer de trajectoire'],
  sources_externes: ['Sources', 'Ajouter des sources externes à l’étude'],
};
const joli = s => { const x = String(s || '').replace(/_/g, ' ').trim(); return x ? x[0].toUpperCase() + x.slice(1) : 'Action'; };
const typeChip = t => (TYPES[t] || [joli(t)])[0];
const typeLabel = t => (TYPES[t] || [null, joli(t)])[1];
const ECRANS = { standard: 'Écran standard', acquisition: 'Écran Acquisition', us_floride: 'Floride · med spas', us_texas: 'Texas · med spas' };
const VERDICTS = { tenir: ['Tenir le cap', 'var(--cash)'], ajuster_prix: ['Ajuster les prix', 'var(--wait)'], changer_niche: ['Changer de niche', 'var(--wait)'], changer_offre: ['Changer d’offre', 'var(--wait)'], alerte: ['Alerte', 'var(--alert)'] };
const LEVELS = ['Toujours me demander', 'Autonome après 5 OK', 'Autonome'];
const STATE_TXT = { run: 'En cours', online: 'En ligne', wait: 'Attend ta décision', idle: 'En veille', ok: 'À jour', gate: 'Station', err: 'Erreur' };
const PLACE = { fr: { owner: 'Jay', nom: 'France', clocks: [['Paris', 'Europe/Paris']], call: [9, 19] }, us: { owner: 'Junior', nom: 'USA', clocks: [['Tampa', 'America/New_York'], ['Austin', 'America/Chicago']], call: [9, 18] } };

/* ---------- icônes (maquette) ---------- */
const I = {
  hermes: '<path d="M12 21V11"/><path d="M8.5 21h7"/><circle cx="12" cy="8.5" r="2"/><path d="M7.6 4.2a6.2 6.2 0 0 0 0 8.6"/><path d="M16.4 4.2a6.2 6.2 0 0 1 0 8.6"/>',
  prospect: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1"/>',
  proposals: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 12h6M9.5 15.5h6"/>',
  finance: '<ellipse cx="12" cy="6.5" rx="7" ry="2.5"/><path d="M5 6.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5"/><path d="M5 11.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5"/>',
  clients: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M15.6 14.6c2.6-.3 4.4 1.1 5 4.4"/>',
  agenda: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  market: '<path d="M4 20h16"/><path d="M7 16v-4M12 16V7M17 16v-6"/>',
  approve: '<path d="M4 7l2 2 3-3.5"/><path d="M12 7.5h8"/><path d="M4 15l2 2 3-3.5"/><path d="M12 15.5h8"/>',
  report: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  research: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  gate: '<rect x="5" y="3.5" width="10" height="17" rx="1"/><path d="M15 6.5l4 1.3v12.7h-4"/><path d="M12 12h.01"/>',
  agents: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><circle cx="12" cy="12" r="2.2"/><path d="M7.5 7.5l3 3M16.5 7.5l-3 3M7.5 16.5l3-3M16.5 16.5l-3-3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const svg = (k, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k] || ''}</svg>`;

/* =====================================================================
   Couche de données : une seule interface, deux sources (Supabase, démo)
   ===================================================================== */
function createSource(config) {
  return config.demo ? createDemoSource(window.COCKPIT_DEMO) : createSupabaseSource(config);
}

// Erreur lisible en français (garde le code technique à part)
function erreur(message, extra = {}) { const e = new Error(message); Object.assign(e, extra); return e; }
const estReseau = e => /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(String(e && (e.message || e)));
function messageDb(e, repli) {
  if (!e) return repli;
  if (estReseau(e)) return 'Connexion perdue : vérifie internet, puis réessaie.';
  // les fonctions du cockpit (decider_action, changer_autonomie) lèvent des messages en français
  if (['P0001', 'P0002', '42501', '22023'].includes(e.code) && e.message) return e.message;
  return e.code ? `${repli} (code ${e.code})` : repli;
}

function createSupabaseSource(config) {
  const sb = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const lignes = async (q, nom) => {
    const { data, error } = await q;
    if (error) throw erreur(`Lecture impossible : ${nom}`, { cause: error, code: error.code, table: nom });
    return data || [];
  };
  // lit une table par pages de 1 000 lignes (limite par défaut de l'API)
  const toutes = async (table, colonnes, ordres) => {
    const out = [];
    for (let de = 0; de < 100000; de += 1000) {
      let q = sb.from(table).select(colonnes);
      for (const o of ordres) q = q.order(o, { ascending: true }); // ordre total : pages sans trou ni doublon
      const page = await lignes(q.range(de, de + 999), table);
      out.push(...page);
      if (page.length < 1000) break;
    }
    return out;
  };
  const jeton = async () => { const { data } = await sb.auth.getSession(); return data && data.session ? data.session.access_token : null; };

  return {
    mode: 'supabase',
    now: () => new Date(),
    async getSession() { const { data } = await sb.auth.getSession(); return data ? data.session : null; },
    onAuth(cb) { const { data } = sb.auth.onAuthStateChange((ev, session) => cb(ev, session)); return () => data.subscription.unsubscribe(); },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; },
    async resetPassword(email) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw error; },
    async updatePassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) throw error; },
    async signOut() { const { error } = await sb.auth.signOut(); if (error && !estReseau(error)) throw error; },
    async loadProfile() {
      const session = await this.getSession();
      if (!session) return null;
      const rows = await lignes(sb.from('profils').select('id,nom,role,marche').eq('id', session.user.id).limit(1), 'profils');
      return rows[0] || null;
    },
    async loadAll() {
      const now = new Date();
      const moisParis = ymd(now, 'Europe/Paris').slice(0, 8) + '01';
      const lectures = {
        resume: () => lignes(sb.from('v_cash_resume').select('*'), 'v_cash_resume'),
        attendu: () => lignes(sb.from('v_cash_attendu').select('*').order('mois', { ascending: true }), 'v_cash_attendu'),
        cumul: () => toutes('v_cash_cumul', 'marche,jour,cumul,cumul_eur', ['jour', 'marche']),
        seuils: () => lignes(sb.from('v_seuils').select('*').limit(1), 'v_seuils').then(r => r[0] || null),
        partage: () => lignes(sb.from('v_partage').select('*'), 'v_partage'),
        clients: () => lignes(sb.from('clients').select('*').order('debut', { ascending: true }), 'clients'),
        actions: () => lignes(sb.from('actions').select('*').eq('statut', 'en_attente').order('cree_le', { ascending: true }), 'actions'),
        autonomie: () => lignes(sb.from('autonomie').select('*'), 'autonomie'),
        messages: () => lignes(sb.from('messages').select('*').order('cree_le', { ascending: false }).limit(50), 'messages').then(r => r.reverse()),
        rapport: () => lignes(sb.from('rapports').select('*').order('jour', { ascending: false }).limit(1), 'rapports').then(r => r[0] || null),
        agents: () => lignes(sb.from('agents_etat').select('*'), 'agents_etat'),
        journal: () => lignes(sb.from('journal').select('*').order('cree_le', { ascending: false }).limit(30), 'journal'),
        objectifs: () => lignes(sb.from('objectifs').select('*').eq('mois', moisParis), 'objectifs'),
        appels: () => toutes('appels', 'id,marche,ecran,lead_ref,statut,note,rappel_le,maj', ['id']),
      };
      const cles = Object.keys(lectures);
      const res = await Promise.allSettled(cles.map(k => lectures[k]()));
      const snap = { erreurs: [], extras: null };
      res.forEach((r, i) => {
        if (r.status === 'fulfilled') snap[cles[i]] = r.value;
        else { snap[cles[i]] = ['seuils', 'rapport'].includes(cles[i]) ? null : []; snap.erreurs.push(r.reason); }
      });
      if (snap.erreurs.length === cles.length) throw snap.erreurs[0];
      return snap;
    },
    subscribe(onChange, onStatus) {
      const ch = sb.channel('cockpit');
      for (const t of TABLES_TEMPS_REEL) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, p => onChange({ table: t, type: p.eventType, row: p.new || {}, old: p.old || {} }));
      }
      jeton().then(t => { if (t) sb.realtime.setAuth(t); }).finally(() => ch.subscribe(st => onStatus && onStatus(st)));
      return () => { sb.removeChannel(ch); };
    },
    async decide(id, ok, correction) {
      const { data, error } = await sb.rpc('decider_action', { p_id: id, p_ok: ok, p_correction: correction || null });
      if (error) throw erreur(messageDb(error, 'La décision n’a pas pu être enregistrée.'), { code: error.code });
      return data;
    },
    async setAutonomy(agent, type, niveau) {
      const { data, error } = await sb.rpc('changer_autonomie', { p_agent: agent, p_type: type, p_niveau: niveau });
      if (error) throw erreur(messageDb(error, 'Le niveau n’a pas pu être changé.'), { code: error.code });
      return data;
    },
    async sendMessage(message, marche) {
      const t = await jeton();
      if (!t) throw erreur('Ta session a expiré : reconnecte-toi.', { status: 401 });
      let rep;
      try {
        rep = await fetch('/api/hermes/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
          body: JSON.stringify({ message, marche }),
        });
      } catch { throw erreur('Connexion perdue : ton message n’est pas parti. Réessaie.', { status: 0 }); }
      let corps = {};
      try { corps = await rep.json(); } catch { /* réponse vide */ }
      if (!rep.ok) {
        const repli = { 401: 'Ta session a expiré : reconnecte-toi.', 403: 'Ton compte n’a pas encore de profil dans le cockpit.', 429: 'Trop de messages d’un coup : attends une minute.', 502: 'Hermès ne répond pas, réessaie dans un instant.', 503: 'Hermès n’est pas encore branché sur ce cockpit.' }[rep.status];
        throw erreur((corps && typeof corps.error === 'string' && corps.error) || repli || 'Le message n’a pas pu partir.', { status: rep.status });
      }
      return { reply: String(corps.reply || ''), messageId: corps.messageId || null };
    },
  };
}

function createDemoSource(D) {
  if (!D) throw erreur('Les données d’exemple (demo.js) ne se sont pas chargées.');
  const copie = o => JSON.parse(JSON.stringify(o));
  const t = copie(D.tables), v = copie(D.vues);
  const debut = Date.now(), base = new Date(D.now).getTime();
  const now = () => new Date(base + (Date.now() - debut));
  const abonnes = new Set();
  const emettre = (table, type, row) => abonnes.forEach(f => { try { f({ table, type, row, old: {} }); } catch (e) { console.error(e); } });
  let seq = 0;
  const nouvelId = p => `${p}-${Date.now().toString(36)}-${++seq}`;
  const iso = () => now().toISOString();
  const journaliser = (marche, agent, texte) => { const row = { id: nouvelId('j'), marche, agent, texte, cree_le: iso() }; t.journal.push(row); emettre('journal', 'INSERT', row); };
  let minuterie = null, pas = 0;
  const simuler = () => {
    const ev = D.simulation[pas++ % D.simulation.length];
    if (ev.appel) {
      const lead = t.appels.find(a => a.marche === ev.appel && a.statut === 'a_appeler');
      if (lead) { lead.statut = 'joint'; lead.maj = iso(); }
    }
    journaliser(ev.marche, ev.agent, ev.texte);
  };
  return {
    mode: 'demo',
    now,
    async getSession() { return { user: { id: D.profil.id } }; },
    onAuth() { return () => {}; },
    async signIn() {}, async resetPassword() {}, async updatePassword() {}, async signOut() {},
    async loadProfile() { return { ...D.profil }; },
    async loadAll() {
      return {
        resume: [...v.v_cash_resume], attendu: [...v.v_cash_attendu], cumul: [...v.v_cash_cumul], seuils: { ...v.v_seuils }, partage: [...v.v_partage],
        clients: [...t.clients], actions: t.actions.filter(a => a.statut === 'en_attente'), autonomie: t.autonomie.map(a => ({ ...a })),
        messages: t.messages.slice(-50), rapport: t.rapports[0] || null, agents: [...t.agents_etat],
        journal: [...t.journal].sort((a, b) => ms(b.cree_le) - ms(a.cree_le)).slice(0, 30),
        objectifs: [...t.objectifs], appels: t.appels, extras: D.extras, erreurs: [],
      };
    },
    subscribe(onChange, onStatus) {
      abonnes.add(onChange);
      if (onStatus) onStatus('DEMO');
      if (!minuterie && !RM) minuterie = setInterval(simuler, 4200);
      return () => { abonnes.delete(onChange); if (!abonnes.size && minuterie) { clearInterval(minuterie); minuterie = null; } };
    },
    async decide(id, ok, correction) {
      const a = t.actions.find(x => x.id === id);
      if (!a) throw erreur('Action introuvable.');
      if (a.statut !== 'en_attente') throw erreur(`Cette action a déjà été décidée (statut : ${a.statut}).`);
      const corr = (correction || '').trim() || null;
      Object.assign(a, { statut: ok ? 'validee' : 'refusee', decide_par: D.profil.id, decide_le: iso(), correction: corr });
      let au = t.autonomie.find(x => x.agent === a.agent && x.type_action === a.type_action);
      if (!au) { au = { agent: a.agent, type_action: a.type_action, niveau: 0, verrou: false, ok_consecutifs: 0 }; t.autonomie.push(au); }
      if (ok && !corr) au.ok_consecutifs += 1; else { au.ok_consecutifs = 0; au.niveau = Math.max(au.niveau - 1, 0); }
      emettre('actions', 'UPDATE', { ...a });
      journaliser(a.marche, a.agent, `${!ok ? 'Refusée' : corr ? 'Validée avec correction' : 'Validée'} par ${D.profil.nom} : ${a.titre}`);
      return { ...a };
    },
    async setAutonomy(agent, type, niveau) {
      let au = t.autonomie.find(x => x.agent === agent && x.type_action === type);
      if (!au) { au = { agent, type_action: type, niveau: 0, verrou: false, ok_consecutifs: 0 }; t.autonomie.push(au); }
      if (au.verrou && niveau > 0) throw erreur('Action verrouillée : elle demande toujours une validation (niveau 0).');
      au.niveau = niveau; au.ok_consecutifs = 0;
      journaliser(null, agent, `Autonomie « ${type} » : ${['toujours demander', 'autonome après 5 OK', 'autonome'][niveau]}, décidé par ${D.profil.nom}`);
      return { ...au };
    },
    async sendMessage(message, marche) {
      const moi = { id: nouvelId('m'), auteur: 'jay', auteur_id: D.profil.id, marche, type: 'message', contenu: message, meta: {}, cree_le: iso() };
      t.messages.push(moi); emettre('messages', 'INSERT', moi);
      await sleep(RM ? 200 : 1100);
      const rep = { id: nouvelId('m'), auteur: 'hermes', auteur_id: null, marche, type: 'message', contenu: D.reponse, meta: {}, cree_le: iso() };
      t.messages.push(rep); emettre('messages', 'INSERT', rep);
      return { reply: rep.contenu, messageId: rep.id };
    },
  };
}

/* =====================================================================
   Modèle : des lignes de la base aux chiffres de chaque station
   ===================================================================== */
const ZERO = m => ({ marche: m, devise: CUR[m === 'total' ? 'qg' : m], cash_mois: 0, cash_mois_eur: 0, cumul: 0, cumul_eur: 0, premier_paiement: null, mrr: 0, mrr_eur: 0, objectif_cash: null, objectif_clients: null, clients_signes_mois: 0 });

function buildModel(snap, now) {
  const M = { now, snap, extras: snap.extras || null };
  M.resume = { fr: ZERO('fr'), us: ZERO('us'), total: ZERO('total') };
  for (const r of snap.resume || []) if (M.resume[r.marche]) M.resume[r.marche] = { ...ZERO(r.marche), ...r };
  M.attendu = { fr: [], us: [], total: [] };
  for (const r of snap.attendu || []) if (M.attendu[r.marche]) M.attendu[r.marche].push(r);
  for (const k in M.attendu) M.attendu[k].sort((a, b) => (a.mois < b.mois ? -1 : 1));
  M.cumul = { fr: [], us: [], total: [] };
  for (const r of snap.cumul || []) if (M.cumul[r.marche]) M.cumul[r.marche].push([String(r.jour).slice(0, 10), num(r.marche === 'total' ? r.cumul_eur : r.cumul)]);
  for (const k in M.cumul) M.cumul[k].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  M.seuils = snap.seuils || null;
  const partage = snap.partage || [];
  M.partage = { mois: partage.find(p => p.periode === 'mois') || partage[0] || null, annee: partage.find(p => p.periode === 'annee') || null };
  M.clients = (snap.clients || []).filter(c => (c.statut || 'actif') === 'actif');
  M.actions = (snap.actions || []).filter(a => a.statut === 'en_attente');
  M.autonomie = snap.autonomie || [];
  M.rapport = snap.rapport || null;
  const ordre = ['hermes', 'prospection_fr', 'prospection_us', 'finance', 'paperasse', 'reporter', 'researcher', 'suivi_clients'];
  M.agents = [...(snap.agents || [])].sort((a, b) => ((ordre.indexOf(a.agent) + 99) % 99) - ((ordre.indexOf(b.agent) + 99) % 99));
  M.agentMap = Object.fromEntries(M.agents.map(a => [a.agent, a]));
  M.journal = [...(snap.journal || [])].sort((a, b) => ms(b.cree_le) - ms(a.cree_le));
  M.objectifs = Object.fromEntries((snap.objectifs || []).map(o => [o.marche, o]));
  M.appels = { fr: appelsMarche(snap.appels || [], 'fr', now), us: appelsMarche(snap.appels || [], 'us', now) };
  M.agenda = { fr: agendaMarche(M, 'fr'), us: agendaMarche(M, 'us') };
  return M;
}

function appelsMarche(rows, m, now) {
  const tz = TZ[m], auj = ymd(now, tz), ecrans = new Map();
  let today = 0, left = 0;
  const demos = [], rappels = [];
  for (const r of rows) {
    if (r.marche !== m) continue;
    const e = ecrans.get(r.ecran) || { code: r.ecran, nom: ECRANS[r.ecran] || joli(r.ecran), total: 0, left: 0 };
    e.total++;
    if (r.statut === 'a_appeler' || !r.statut) { e.left++; left++; }
    else if (r.maj && ymd(r.maj, tz) === auj) today++;
    if (r.rappel_le && toDate(r.rappel_le) >= now) (r.statut === 'demo' ? demos : rappels).push(r);
    ecrans.set(r.ecran, e);
  }
  return { screens: [...ecrans.values()], today, left, demos, rappels, total: rows.filter(r => r.marche === m).length };
}

function agendaMarche(M, m) {
  const ev = [];
  for (const r of M.appels[m].demos) ev.push({ d: r.rappel_le, t: `Démo · ${r.lead_ref}${r.note ? ' · ' + r.note : ''}`, demo: true });
  for (const r of M.appels[m].rappels) ev.push({ d: r.rappel_le, t: `Rappel · ${r.lead_ref}${r.note ? ' · ' + r.note : ''}` });
  for (const c of M.clients) if (c.marche === m && c.prochain_point && toDate(c.prochain_point) >= M.now) ev.push({ d: c.prochain_point, t: `Point mensuel · ${c.nom}`, booke: c.point_booke });
  return ev.sort((a, b) => toDate(a.d) - toDate(b.d));
}

// Chiffres d'une station (fr, us) ou du QG
function chiffres(k) {
  const r = M.resume[k === 'qg' ? 'total' : k];
  return {
    key: k, cur: CUR[k], tz: TZ[k],
    cash: num(r.cash_mois), objective: r.objectif_cash == null ? null : num(r.objectif_cash), mrr: num(r.mrr), cumul: num(r.cumul),
    signed: num(r.clients_signes_mois), target: r.objectif_clients == null ? null : num(r.objectif_clients), premier: r.premier_paiement,
    attendu: M.attendu[k === 'qg' ? 'total' : k], steps: M.cumul[k === 'qg' ? 'total' : k],
  };
}
const pending = k => M.actions.filter(a => k === 'qg' || a.marche === k);
const autoRow = (agent, type) => M.autonomie.find(a => a.agent === agent && a.type_action === type);
const promotions = () => M.autonomie.filter(a => !a.verrou && num(a.niveau) < 2 && num(a.ok_consecutifs) >= 5);
const agentNom = a => (M.agentMap[a] && M.agentMap[a].nom) || AGENT_NOM[a] || joli(a);
const estAdmin = () => !!profile && profile.role === 'admin';
const peutDecider = a => estAdmin() || (!!profile && !!a.marche && a.marche === profile.marche);
const hermesBranche = () => source.mode === 'demo' || !!config.hermes;

/* =====================================================================
   État de l'application
   ===================================================================== */
let config = {}, source = null, profile = null, M = null;
let station = 'qg', slide = 0, roomsNow = [], lastCash = null, lastRing = null;
let stopTempsReel = null, stopAuth = null, minuteries = [], refreshTimer = null, refreshing = false, refreshAgain = false;
let statutDirect = '', panelState = null, panelOpener = null, appStarted = false, recovery = false;
const endpoints = {};
const busy = new Set();
const chat = { rows: new Map(), local: [], open: false, sending: false, affiches: new Set(), seq: 0 };

/* ---------- écrans ---------- */
function show(id) {
  for (const s of ['boot', 'auth', 'fatal', 'app']) $('#' + s).hidden = s !== id;
  if (id !== 'app') closePanel(true);
}
function bootText(t) { $('#bootText').textContent = t; show('boot'); }
function fatal(titre, texte, opts = {}) {
  $('#fatalTitle').textContent = titre;
  $('#fatalText').textContent = texte;
  $('#fatalRetry').hidden = opts.retry === false;
  $('#fatalLogout').hidden = !opts.logout;
  $('#fatalDemo').hidden = !opts.demo;
  show('fatal');
}
function toast(texte, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  el.textContent = texte;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 7000 : 4200);
}

/* ---------- connexion ---------- */
function showAuth(mode, info) {
  show('auth');
  $('#loginForm').hidden = mode !== 'login';
  $('#forgotForm').hidden = mode !== 'forgot';
  $('#recoverForm').hidden = mode !== 'recover';
  for (const id of ['loginError', 'forgotError', 'forgotOk', 'recoverError']) $('#' + id).hidden = true;
  const li = $('#loginInfo'); li.hidden = !info; li.textContent = info || '';
  $('#demoLink').hidden = !!config.demo;
  const focus = { login: '#loginEmail', forgot: '#forgotEmail', recover: '#newPassword' }[mode];
  // Curseur dans le premier champ, sauf si la personne (ou le remplissage automatique)
  // est déjà dans un champ : sinon la suite de sa saisie partirait dans le mauvais champ.
  const placer = () => {
    const f = $(focus), actif = document.activeElement;
    const dansUnChamp = actif && /^(INPUT|TEXTAREA|SELECT)$/.test(actif.tagName) && actif.offsetParent !== null;
    if (f && !dansUnChamp) f.focus();
  };
  placer();
  setTimeout(placer, 30);
}
function formError(id, texte, champ) {
  const el = $('#' + id); el.textContent = texte; el.hidden = !texte;
  $$('input[aria-invalid]').forEach(i => i.removeAttribute('aria-invalid'));
  if (champ) { const c = $(champ); c.setAttribute('aria-invalid', 'true'); c.focus(); }
}
const emailValide = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
function messageConnexion(err) {
  const m = String(err && err.message || '').toLowerCase(), st = err && err.status;
  if (/invalid login credentials|invalid_grant|invalid email or password/.test(m)) return 'E-mail ou mot de passe incorrect. Vérifie les deux, puis réessaie.';
  if (/email not confirmed/.test(m)) return 'Ton adresse e-mail n’est pas encore confirmée : ouvre le lien reçu par e-mail, puis reconnecte-toi.';
  if (st === 429 || /rate limit|too many/.test(m)) return 'Trop d’essais d’un coup. Attends quelques minutes avant de réessayer.';
  if (/banned/.test(m)) return 'Ce compte est bloqué. Demande à Jay de le réactiver.';
  if (estReseau(err) || st === 0 || /fetch/.test(m)) return 'Impossible de joindre le serveur de connexion. Vérifie ta connexion internet.';
  return 'La connexion a échoué. Réessaie dans un instant.';
}

async function onLogin(e) {
  e.preventDefault();
  const email = $('#loginEmail').value.trim(), pw = $('#loginPassword').value;
  if (!email) return formError('loginError', 'Indique ton adresse e-mail.', '#loginEmail');
  if (!emailValide(email)) return formError('loginError', 'Cette adresse e-mail n’a pas l’air complète (exemple : jay@exemple.fr).', '#loginEmail');
  if (!pw) return formError('loginError', 'Indique ton mot de passe.', '#loginPassword');
  formError('loginError', '');
  const b = $('#loginSubmit'); b.disabled = true; b.textContent = 'Connexion…';
  try {
    await source.signIn(email, pw);
    $('#loginPassword').value = '';
    await startApp();
  } catch (err) {
    formError('loginError', messageConnexion(err), '#loginPassword');
  } finally { b.disabled = false; b.textContent = 'Se connecter'; }
}
async function onForgot(e) {
  e.preventDefault();
  const email = $('#forgotEmail').value.trim();
  $('#forgotOk').hidden = true;
  if (!email || !emailValide(email)) return formError('forgotError', 'Indique l’adresse e-mail de ton compte.', '#forgotEmail');
  formError('forgotError', '');
  const b = $('#forgotSubmit'); b.disabled = true;
  try {
    await source.resetPassword(email);
    const ok = $('#forgotOk');
    ok.textContent = 'C’est parti : si un compte existe pour cette adresse, un e-mail arrive avec un lien pour choisir un nouveau mot de passe. Pense à regarder dans les indésirables.';
    ok.hidden = false;
  } catch (err) {
    const m = String(err && err.message || '').toLowerCase();
    formError('forgotError', err && (err.status === 429 || /rate limit|seconds/.test(m))
      ? 'Un e-mail est déjà parti il y a peu : attends une minute avant d’en demander un autre.'
      : estReseau(err) ? 'Impossible de joindre le serveur de connexion. Vérifie ta connexion internet.' : 'L’e-mail n’a pas pu partir. Réessaie dans un instant.');
  } finally { b.disabled = false; }
}
async function onRecover(e) {
  e.preventDefault();
  const p1 = $('#newPassword').value, p2 = $('#newPassword2').value;
  if (p1.length < 8) return formError('recoverError', 'Le mot de passe doit faire au moins 8 caractères.', '#newPassword');
  if (p1 !== p2) return formError('recoverError', 'Les deux mots de passe ne sont pas identiques.', '#newPassword2');
  formError('recoverError', '');
  const b = $('#recoverSubmit'); b.disabled = true;
  try {
    await source.updatePassword(p1);
    recovery = false;
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignoré */ }
    toast('Mot de passe changé.', 'ok');
    await startApp();
  } catch (err) {
    const m = String(err && err.message || '').toLowerCase();
    formError('recoverError', /same/.test(m) ? 'Choisis un mot de passe différent de l’ancien.'
      : /weak|short|characters/.test(m) ? 'Mot de passe trop faible : mets au moins 8 caractères, avec des lettres et des chiffres.'
      : estReseau(err) ? 'Impossible de joindre le serveur de connexion. Vérifie ta connexion internet.'
      : 'Le lien a peut-être expiré. Redemande un e-mail depuis « Mot de passe oublié ».');
  } finally { b.disabled = false; }
}

function onAuthEvent(ev) {
  if (ev === 'PASSWORD_RECOVERY') { recovery = true; stopApp(); showAuth('recover'); }
  else if (ev === 'SIGNED_OUT' && appStarted) { stopApp(); showAuth('login', 'Tu as été déconnecté. Reconnecte-toi pour revenir au cockpit.'); }
}

async function logout() {
  if (source.mode === 'demo') return;
  try { await source.signOut(); } catch { /* on sort quand même */ }
  stopApp();
  showAuth('login', 'Tu es bien déconnecté.');
}

/* ---------- chargement de supabase-js (version figée) ---------- */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.supabase && window.supabase.createClient) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    const t = setTimeout(() => reject(new Error('délai dépassé')), 20000);
    s.onload = () => { clearTimeout(t); window.supabase && window.supabase.createClient ? resolve() : reject(new Error('supabase absent')); };
    s.onerror = () => { clearTimeout(t); reject(new Error('chargement impossible')); };
    document.head.appendChild(s);
  });
}

/* ---------- démarrage ---------- */
async function boot() {
  bootText('Chargement du cockpit…');
  try {
    const r = await fetch('/api/config', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    config = await r.json();
  } catch {
    return fatal('Le cockpit ne répond pas', 'Impossible de lire sa configuration. Vérifie ta connexion internet, puis réessaie.');
  }
  const forceDemo = new URLSearchParams(location.search).has('demo');
  if (config.demo === true || forceDemo) {
    config = { ...config, demo: true, demoForcee: forceDemo && config.demo !== true };
    try { source = createSource(config); } catch (e) { return fatal('Mode démo indisponible', e.message, { retry: true }); }
    return startApp();
  }
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    return fatal('Cockpit pas encore configuré', 'SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY manquent sur le serveur. En attendant, la démo montre le cockpit avec des données d’exemple.', { demo: true });
  }
  recovery = /type=recovery/.test(location.hash);
  try { await loadScript(SUPABASE_JS); } catch {
    return fatal('Le module de connexion ne s’est pas chargé', 'Le fichier supabase-js (cdn.jsdelivr.net) est inaccessible. Vérifie ta connexion internet, puis réessaie.');
  }
  try { source = createSource(config); } catch {
    return fatal('Connexion à Supabase impossible', 'L’adresse ou la clé de Supabase est mal configurée sur le serveur.', { retry: false });
  }
  stopAuth = source.onAuth(onAuthEvent);
  let session = null;
  try { session = await source.getSession(); } catch { /* traité comme sans session */ }
  if (recovery && session) return showAuth('recover');
  if (session) return startApp();
  showAuth('login');
}

async function startApp() {
  if (appStarted) return;
  bootText('Chargement des données…');
  try {
    profile = await source.loadProfile();
  } catch (e) {
    return fatal('Ton profil n’a pas pu être lu', estReseau(e.cause || e) ? 'Connexion perdue. Vérifie internet, puis réessaie.' : 'Supabase a refusé la lecture. Réessaie, ou reconnecte-toi.', { logout: true });
  }
  if (!profile) {
    return fatal('Ton compte n’a pas encore accès au cockpit', 'La connexion a marché, mais ton profil n’existe pas encore. Demande à Jay de t’ajouter dans la table « profils » de Supabase.', { retry: true, logout: true });
  }
  let snap;
  try { snap = await source.loadAll(); } catch (e) {
    return fatal('Les données n’ont pas pu être lues', estReseau(e.cause || e) ? 'Connexion perdue. Vérifie internet, puis réessaie.' : 'Supabase a refusé la lecture des données. Réessaie dans un instant.', { logout: source.mode !== 'demo' });
  }
  M = buildModel(snap, source.now());
  chat.rows.clear(); chat.local = [];
  for (const r of snap.messages || []) chat.rows.set(r.id, r);
  signalerErreurs(snap);
  appStarted = true;

  const demo = source.mode === 'demo';
  $('#demoBadge').hidden = !demo;
  $('#demoBanner').hidden = !demo;
  $('#logout').hidden = demo;
  $('#leaveDemo').hidden = !(demo && config.demoForcee);
  $('#meName').innerHTML = demo ? '' : `<b>${esc(profile.nom)}</b> · ${profile.role === 'admin' ? 'admin' : 'associé'}`;
  $('#hermesLight').dataset.s = hermesBranche() ? 'online' : 'idle';
  show('app');

  const h = location.hash.replace('#', '');
  station = ['fr', 'qg', 'us'].includes(h) ? h : profile.role === 'admin' ? 'qg' : profile.marche === 'us' ? 'us' : profile.marche === 'fr' ? 'fr' : 'qg';
  render(station);
  majNonLus();
  onStatutDirect(source.mode === 'demo' ? 'DEMO' : 'CONNEXION');
  stopTempsReel = source.subscribe(onChange, onStatutDirect);
  minuteries.push(setInterval(() => {
    if (!M) return;
    M.now = source.now();
    const head = $('#stationHead'); if (head) head.innerHTML = headHTML(station);
    $$('[data-live="countdown"]').forEach(el => { el.textContent = countdown(M.now); });
  }, 30000));
  if (source.mode !== 'demo') minuteries.push(setInterval(() => refresh(), 60000));
}

function stopApp() {
  if (stopTempsReel) { try { stopTempsReel(); } catch { /* ignoré */ } stopTempsReel = null; }
  minuteries.forEach(clearInterval); minuteries = [];
  clearTimeout(refreshTimer);
  appStarted = false; profile = null; M = null;
  closePanel(true);
  chat.rows.clear(); chat.local = []; chat.affiches.clear();
}

function signalerErreurs(snap) {
  if (!snap.erreurs || !snap.erreurs.length) return;
  const noms = [...new Set(snap.erreurs.map(e => e.table || '?'))].join(', ');
  toast(`Certaines données n’ont pas pu être lues (${noms}). Le reste est à jour.`, 'err');
}

/* ---------- temps réel ---------- */
function onStatutDirect(st) {
  statutDirect = st;
  const el = $('#journalStatus'); if (!el) return;
  if (st === 'DEMO') el.textContent = 'Activité simulée (données d’exemple)';
  else if (st === 'SUBSCRIBED') el.innerHTML = '<span class="live"><span class="light" data-s="online"></span>En direct</span>';
  else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') el.textContent = 'Direct coupé : mise à jour chaque minute';
  else el.textContent = 'Connexion au direct…';
}

function onChange(ev) {
  if (!M) return;
  const { table, type, row } = ev;
  if (table === 'messages' && type === 'INSERT' && row && row.id) {
    if (chatAdd(row)) { if (chat.open) renderChat(); else majNonLus(); }
  }
  if (table === 'paiements' && type === 'INSERT' && row) toast(`Paiement reçu : ${money(row.montant, row.devise || CUR[row.marche] || 'EUR')}`, 'ok');
  const m = row && row.marche;
  const visible = station === 'qg' || !m || m === station;
  if (visible) {
    const cible = salleDe(table, row);
    if (cible) packet(cible, couleurDe(table, row));
  }
  scheduleRefresh();
}
function salleDe(table, row) {
  const m = row && row.marche, agent = row && row.agent;
  if (table === 'paiements') return station === 'qg' ? (m === 'us' ? 'gate-us' : 'gate-fr') : 'finance';
  if (table === 'actions') return 'valider';
  if (table === 'messages') return 'hermes';
  const qg = { hermes: 'hermes', researcher: 'recherche', reporter: 'rapport', finance: 'finance', prospection_fr: 'gate-fr', prospection_us: 'gate-us', suivi_clients: m === 'us' ? 'gate-us' : 'gate-fr', paperasse: m === 'us' ? 'gate-us' : m === 'fr' ? 'gate-fr' : 'valider' };
  const st = { hermes: 'hermes', paperasse: 'propositions', reporter: 'marche', suivi_clients: 'clients', finance: 'finance', ['prospection_' + station]: 'prospection' };
  const id = (station === 'qg' ? qg : st)[agent] || 'hermes';
  return roomsNow.some(r => r.id === id) ? id : 'hermes';
}
function couleurDe(table, row) {
  if (table === 'paiements') return 'var(--cash)';
  if (table === 'actions') return row && row.statut === 'en_attente' ? 'var(--wait)' : 'var(--cash)';
  if (table === 'agents_etat' && row && row.statut === 'err') return 'var(--alert)';
  if (row && ['finance', 'suivi_clients'].includes(row.agent)) return 'var(--cash)';
  return 'var(--accent)';
}
function scheduleRefresh(delai) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh(), delai != null ? delai : RM ? 250 : 1100);
}
async function refresh() {
  if (!appStarted) return;
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    const snap = await source.loadAll();
    if (!appStarted) return;
    M = buildModel(snap, source.now());
    for (const r of snap.messages || []) chatAdd(r);
    render(station, { soft: true, keepHash: true });
    majNonLus();
    if (panelState && panelState.type === 'room') {
      const actif = document.activeElement;
      if (!(actif && $('#panel').contains(actif) && actif.tagName === 'INPUT')) roomPanel(panelState.id, { keepFocus: true });
    } else if (panelState && panelState.type === 'chat') renderChat();
  } catch (e) {
    if (e && e.code === 'PGRST301') { toast('Ta session a expiré : reconnecte-toi.', 'err'); await logout(); }
  } finally {
    refreshing = false;
    if (refreshAgain) { refreshAgain = false; scheduleRefresh(300); }
  }
}

/* =====================================================================
   Rendu des salles (repris de la maquette, branché sur le modèle)
   ===================================================================== */
const stationRooms = m => [
  { id: 'prospection', area: 'a', kind: 'prospect', name: 'Prospection', agent: 'Agent lead gen', agents: ['prospection_' + m] },
  { id: 'hermes', area: 'b', kind: 'hermes', name: 'Hermès', agent: 'Centre de contrôle', agents: ['hermes'] },
  { id: 'propositions', area: 'c', kind: 'proposals', name: 'Propositions et contrats', agent: 'Agent paperasse', agents: ['paperasse'] },
  { id: 'marche', area: 'd', kind: 'market', name: 'Étude de marché', agent: 'Agent reporter', agents: ['reporter'], types: t => t === 'sources_externes' },
  { id: 'clients', area: 'e', kind: 'clients', name: 'Clients actifs', agent: 'Suivi clients', agents: ['suivi_clients'], types: t => !['booker_demo', 'deplacer_rdv_client'].includes(t) },
  { id: 'finance', area: 'f', kind: 'finance', name: 'Finance', agent: 'Agent finance', agents: ['finance'] },
  { id: 'valider', area: 'g', kind: 'approve', name: 'À valider', agent: m === 'fr' ? 'Décisions de Jay' : 'Décisions de Junior' },
  { id: 'agenda', area: 'h', kind: 'agenda', name: 'Agenda', agent: 'Démos et points mensuels', agents: ['suivi_clients'], types: t => ['booker_demo', 'deplacer_rdv_client', 'booker_point_mensuel'].includes(t) },
];
const ROOMS = {
  qg: [
    { id: 'recherche', area: 'a', kind: 'research', name: 'Recherche rentabilité', agent: 'Agent researcher', agents: ['researcher'] },
    { id: 'hermes', area: 'b', kind: 'hermes', name: 'Hermès', agent: 'Centre de contrôle', agents: ['hermes'] },
    { id: 'rapport', area: 'c', kind: 'report', name: 'Rapport du soir', agent: 'Agent reporter', agents: ['reporter'], types: t => t !== 'sources_externes' },
    { id: 'gate-fr', area: 'd', kind: 'gate', m: 'fr', name: 'Station France', agent: 'Jay' },
    { id: 'gate-us', area: 'e', kind: 'gate', m: 'us', name: 'Station USA', agent: 'Junior' },
    { id: 'finance', area: 'f', kind: 'financeQG', name: 'Finance', agent: 'Agent finance', agents: ['finance'] },
    { id: 'valider', area: 'g', kind: 'approve', name: 'À valider', agent: 'Toutes les salles' },
    { id: 'agents', area: 'h', kind: 'agents', name: 'État des agents', agent: 'Les agents et Hermès' },
  ],
  fr: stationRooms('fr'),
  us: stationRooms('us'),
};

function roomState(r, k) {
  if (r.kind === 'gate') return 'gate';
  if (r.kind === 'approve') return pending(k).length ? 'wait' : 'ok';
  if (r.kind === 'agents') return M.agents.some(a => a.statut === 'err') ? 'err' : M.agents.length ? 'ok' : 'idle';
  if (r.kind === 'hermes') return hermesBranche() ? 'online' : 'idle';
  if (r.kind === 'agenda') return 'ok';
  const a = M.agentMap[(r.agents || [])[0]];
  return a && STATE_TXT[a.statut] ? a.statut : 'idle';
}

const vide = (titre, texte) => `<div class="empty"><b>${esc(titre)}</b><span>${esc(texte)}</span></div>`;

const BODY = {
  prospect(s) {
    const a = M.appels[s.key], owner = PLACE[s.key].owner;
    if (!a.total) return vide('Aucun lead pour l’instant', 'Les écrans d’appel sont recopiés chaque soir dans Supabase : ils apparaîtront ici après la première synchro.');
    return `<div><div class="gauge-top"><span class="k">Appels aujourd’hui · ${esc(owner)}</span><span class="v mono">${a.today} / ${APPELS_JOUR}</span></div>
      <div class="bar"><i style="width:${pct(a.today, APPELS_JOUR)}%"></i></div></div>
      <ul class="mini">${a.screens.map(e => `<li><span>${esc(e.nom)}</span><span class="mono">${e.left === e.total ? 'pas commencé' : `${entier(e.left)} / ${entier(e.total)}`}</span></li>`).join('')}</ul>
      <div class="k">${entier(a.left)} lead${a.left > 1 ? 's' : ''} à appeler</div>`;
  },
  finance(s) {
    const target = s.target || 0, n = Math.min(Math.max(target, s.signed), 12);
    const pilotes = M.clients.filter(c => c.marche === 'fr' && /pilote/i.test(c.palier || '')).length;
    const ligne = s.key === 'fr'
      ? `<li><span>Pilotes signés ${Math.min(pilotes, 3)}/3</span><span class="${pilotes >= 3 ? 'good' : 'warn'}">${pilotes >= 3 ? 'grille normale active' : 'pilotes en cours'}</span></li>`
      : `<li><span>Clients actifs</span><span class="mono">${M.clients.filter(c => c.marche === 'us').length}</span></li>`;
    return `<div><div class="gauge-top"><span class="k">Signés ce mois</span><span class="v mono">${s.signed} / ${target || '—'}</span></div>
      ${n ? `<div class="dots">${Array.from({ length: n }, (_, i) => `<i class="${i < s.signed ? 'on' : ''}"></i>`).join('')}</div>` : ''}</div>
      <ul class="mini"><li><span>Objectif du mois</span><span class="mono">${s.objective == null ? 'pas encore calculé' : money(s.objective, s.cur)}</span></li>
      <li><span>Récurrent signé</span><span class="mono">${money(s.mrr, s.cur)}/mois</span></li>${ligne}</ul>`;
  },
  financeQG() {
    const p = M.partage.mois;
    if (!p) return vide('Partage pas encore calculé', 'Le partage 50/50 se fait sur le résultat du mois, après cotisations et coûts.');
    return `<ul class="mini"><li><span>Cash du mois</span><span class="mono">${money(p.cash_eur)}</span></li>
      <li><span>Cotisations et coûts</span><span class="mono bad">− ${money(num(p.cotisations_eur) + num(p.couts_eur))}</span></li>
      <li><span>Part de Jay (50 %)</span><span class="mono">${money(p.part_jay_eur)}</span></li>
      <li><span>Part de Junior (50 %)</span><span class="mono">${money(p.part_junior_eur)}</span></li></ul>
      <div class="note">Partage sur le résultat (${money(p.resultat_eur)}), jamais sur le cash.</div>`;
  },
  proposals(s) {
    const a = M.appels[s.key], brouillons = pending(s.key).filter(x => x.agent === 'paperasse');
    const actifs = M.clients.filter(c => c.marche === s.key).length;
    return `<div class="track"><div><b>${a.demos.length}</b><span>démos prévues</span></div><div class="${brouillons.length ? 'hot' : ''}"><b>${brouillons.length}</b><span>à relire</span></div><div class="won"><b>${s.signed}</b><span>signés ce mois</span></div><div><b>${actifs}</b><span>clients actifs</span></div></div>
      ${brouillons.length ? `<ul class="mini">${brouillons.slice(0, 3).map(d => `<li><span>${esc(typeChip(d.type_action))} · ${esc(d.titre)}</span><span class="warn">à relire</span></li>`).join('')}</ul>` : '<div class="k">Aucun brouillon à relire</div>'}`;
  },
  market(s) {
    const x = M.extras && M.extras.marche && M.extras.marche[s.key];
    if (!x) return vide('Pas encore d’étude', 'Le reporter ajoutera ici ce que les prospects paient aujourd’hui, à partir des appels et de sources externes.');
    const c = x.compare, max = Math.max(c.leur, c.notre);
    return `<div><div class="k" style="margin-bottom:8px">Leur agence aujourd’hui ou notre offre</div>
      <div class="cmp"><span>Leur agence</span><div class="bar"><i style="width:${pct(c.leur, max)}%;background:var(--ink-3)"></i></div><b class="mono">${money(c.leur, s.cur)}</b></div>
      <div class="cmp"><span>${esc(c.label)}</span><div class="bar cash"><i style="width:${pct(c.notre, max)}%"></i></div><b class="mono">${money(c.notre, s.cur)}</b></div></div>
      <ul class="mini">${x.lignes.map(r => `<li><span>${esc(r[0])}</span><span class="mono">${esc(r[1])}</span></li>`).join('')}</ul>`;
  },
  clients(s) {
    const cl = M.clients.filter(c => c.marche === s.key);
    if (!cl.length) return vide('Aucun client actif', 'Les contrats signés apparaîtront ici, avec leur objectif de garantie.');
    return `<div class="bignum">${cl.length} <span class="k">client${cl.length > 1 ? 's' : ''} actif${cl.length > 1 ? 's' : ''}</span></div>
      ${cl.slice(0, 3).map(c => `<div><div class="gauge-top"><span style="font-size:12.5px">${esc(c.nom)}</span><span class="mono" style="font-size:11.5px;color:var(--ink-3)">${esc(entier(c.resultat_valeur))}/${esc(entier(c.objectif_valeur))} ${esc(c.objectif_garantie || '')}</span></div><div class="bar cash"><i style="width:${pct(num(c.resultat_valeur), num(c.objectif_valeur))}%"></i></div></div>`).join('')}
      ${cl.length > 3 ? `<div class="k">+ ${cl.length - 3} autre${cl.length > 4 ? 's' : ''}</div>` : ''}`;
  },
  approve(s) {
    const items = pending(s.key);
    if (!items.length) return '<div class="note">Rien à valider. Les agents travaillent seuls.</div>';
    return `<div class="bignum mono">${items.length} <span class="k">en attente</span></div>
      ${items.slice(0, 3).map(a => itemHTML(a)).join('')}
      ${items.length > 3 ? `<div class="k">+ ${items.length - 3} autre${items.length > 4 ? 's' : ''} dans la file</div>` : ''}`;
  },
  agenda(s) {
    const ev = M.agenda[s.key];
    if (!ev.length) return vide('Rien de prévu', 'Les démos et les points mensuels des clients s’afficheront ici, à l’heure du marché.');
    return `<div class="cal">${ev.slice(0, 4).map(e => `<div><time>${esc(dayShort(e.d, s.tz))} ${esc(hm(e.d, s.tz))}</time><span>${esc(e.t)}</span></div>`).join('')}</div>`;
  },
  hermes() {
    const dots = [0, 52, 118, 170, 230, 300].map((a, i) => { const r = [42, 30, 46, 22, 36, 48][i]; const x = 60 + r * Math.cos(a * Math.PI / 180), y = 60 + r * Math.sin(a * Math.PI / 180); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${i === 3 ? 'var(--wait)' : 'var(--accent)'}"/>`; }).join('');
    const suivis = M.agents.filter(a => a.agent !== 'hermes').length;
    return `<svg class="radar" viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="sw" x1="0" x2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0"/><stop offset="1" stop-color="var(--accent)" stop-opacity=".35"/></linearGradient></defs>
      <circle class="ring" cx="60" cy="60" r="52"/><circle class="ring" cx="60" cy="60" r="34"/><circle class="ring" cx="60" cy="60" r="16"/>
      <g class="sweep"><path d="M60 60 L112 60 A52 52 0 0 0 96.8 23.2 Z" fill="url(#sw)"/></g>${dots}<circle cx="60" cy="60" r="5" fill="var(--ink)"/></svg>
      <ul class="mini"><li><span>Agents suivis</span><span class="mono">${suivis}</span></li><li><span>Décisions en attente</span><span class="mono warn">${M.actions.length}</span></li>${promotions().length ? `<li><span>Promotions d’autonomie possibles</span><span class="mono good">${promotions().length}</span></li>` : ''}</ul>`;
  },
  report() {
    const r = M.rapport;
    if (!r) return `${vide('Pas encore de rapport', 'Le premier rapport arrivera ce soir à 23:00, ici et dans la messagerie.')}<ul class="mini"><li><span>Prochain rapport</span><span class="mono" data-live="countdown">${countdown(M.now)}</span></li></ul>`;
    const v = VERDICTS[r.verdict] || [joli(r.verdict), 'var(--ink-2)'];
    const d = r.donnees || {};
    return `<div class="verdict"><svg class="needle" viewBox="0 0 24 24" fill="none" stroke="${v[1]}" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 12l4-6"/></svg>${esc(v[0])}</div>
      <ul class="mini"><li><span>Rapport du</span><span class="mono">${esc(dayShort(r.jour))}</span></li>
      ${d.demos_total != null && d.demos_necessaires != null ? `<li><span>Échantillon pour juger le prix</span><span class="mono">${esc(d.demos_total)} / ${esc(d.demos_necessaires)} démos</span></li>` : ''}
      <li><span>Prochain rapport</span><span class="mono" data-live="countdown">${countdown(M.now)}</span></li></ul>`;
  },
  research() {
    const p = M.extras && M.extras.pistes;
    if (!p) return vide('Pas encore de piste', 'Le researcher déposera ici ses pistes : offres, impôts, embauches. Rien ne change sans ta validation.');
    return `<ul class="mini">${p.map(x => `<li><span><span class="chip ${x[3] ? 'w' : ''}">${esc(x[0])}</span> ${esc(x[1])}</span><span class="${x[3] ? 'warn' : ''}">${esc(x[2])}</span></li>`).join('')}</ul>`;
  },
  agents() {
    if (!M.agents.length) return vide('Aucune nouvelle des agents', 'Chaque agent apparaîtra ici dès sa première exécution.');
    return `<ul class="mini">${M.agents.map(a => `<li><span style="display:flex;align-items:center;gap:8px;min-width:0"><span class="light" data-s="${esc(a.statut)}"></span>${esc(a.nom || agentNom(a.agent))}</span><span class="mono" style="color:var(--ink-3)">${num(a.cout_jour_eur) ? esc(num(a.cout_jour_eur).toFixed(2).replace('.', ',')) + ' €' : '—'}</span></li>`).join('')}</ul>`;
  },
  gate(r) {
    const k = r.m, s = chiffres(k), a = M.appels[k], ev = M.agenda[k], demo = ev.find(e => e.demo), next = ev[0];
    return `<div class="gate-stats"><div><b>${money(s.cash, s.cur)}</b><span>cash du mois</span></div><div><b>${M.clients.filter(c => c.marche === k).length}</b><span>clients actifs</span></div>
      <div><b>${a.today} / ${APPELS_JOUR}</b><span>appels aujourd’hui</span></div><div><b>${s.signed} / ${s.target == null ? '—' : s.target}</b><span>signés ce mois</span></div></div>
      <ul class="mini"><li><span>Prochaine démo</span><span class="mono">${demo ? esc(day(demo.d, s.tz) + ' ' + hm(demo.d, s.tz)) : 'aucune'}</span></li>
      <li><span>Décisions en attente</span><span class="mono warn">${pending(k).length}</span></li>
      <li><span>Leads à appeler</span><span class="mono">${entier(a.left)}</span></li></ul>
      <div class="room-foot"><q>${esc(next ? `${next.t}, ${day(next.d, s.tz)} ${hm(next.d, s.tz)}.` : 'Rien de prévu pour l’instant.')}</q><span class="enter-link">Entrer ${svg('arrow')}</span></div>`;
  },
};

function itemHTML(a) {
  const ok = peutDecider(a), id = esc(a.id), b = busy.has(a.id) ? ' disabled' : '';
  const titre = ok ? '' : ` title="${esc(a.marche ? 'Seul Jay ou Junior pour ce marché peut décider' : 'Seul Jay (admin) peut décider')}"`;
  return `<div class="item" data-item="${id}"><span class="chip ${a.marche === 'us' ? 'g' : a.marche === 'fr' ? 'w' : ''}">${esc(typeChip(a.type_action))}</span><span class="t" title="${esc(a.titre)}">${esc(a.titre)}</span><button class="ok-btn" data-ok="${id}" type="button"${ok ? b : ' disabled'}${titre}>OK</button><button class="no-btn" data-no="${id}" type="button" aria-label="Refuser"${ok ? b : ' disabled'}${titre}>Non</button></div>`;
}

function footHTML(r, k) {
  if (r.kind === 'gate') return '';
  let said = '', when = '';
  if (r.kind === 'approve') { const n = pending(k).length; said = n ? `${n} décision${n > 1 ? 's' : ''} en attente.` : 'Rien en attente.'; when = 'à l’instant'; }
  else if (r.kind === 'agents') { const n = M.agents.filter(a => a.statut === 'err').length; said = n ? `${n} agent${n > 1 ? 's' : ''} en erreur.` : M.agents.length ? 'Aucun agent en erreur.' : 'Pas encore de nouvelles.'; }
  else if (r.kind === 'agenda') { const e = M.agenda[k][0]; said = e ? `${e.t}.` : 'Rien de prévu.'; when = e ? quand(e.d, M.now, TZ[k]) : ''; }
  else {
    const a = M.agentMap[(r.agents || [])[0]];
    said = a && a.derniere_phrase ? a.derniere_phrase : 'Pas encore de nouvelles de cet agent.';
    when = a ? quand(a.derniere_execution || a.maj, M.now, TZ[k]) : '';
  }
  return `<div class="room-foot"><q>${esc(said)}</q><time>${esc(when)}</time></div>`;
}

function roomHTML(r, i, k, soft) {
  const state = r.kind === 'gate'
    ? `<span class="state"><span class="mono">${esc(PLACE[r.m].clocks.map(c => `${c[0]} ${clock(c[1], M.now)}`).join(' · '))}</span></span>`
    : `<span class="state" data-s="${r.s}"><span class="light" data-s="${r.s}"></span>${STATE_TXT[r.s]}</span>`;
  const data = r.kind === 'gate' ? r : chiffres(k);
  return `<article class="room${RM || soft ? '' : ' enter'}" style="grid-area:${r.area};--i:${i}" data-room="${r.id}" data-kind="${r.kind}" tabindex="0" aria-label="${esc(r.name)}">
    <div class="room-head"><span class="ico">${svg(r.kind === 'financeQG' ? 'finance' : r.kind)}</span><div class="room-title"><div class="room-name">${esc(r.name)}</div><div class="room-agent">${esc(r.agent)}</div></div>${state}</div>
    <div class="room-body">${BODY[r.kind](data)}</div>${footHTML(r, k)}</article>`;
}

/* ---------- noyau cash ---------- */
function coreHTML(k) {
  const s = chiffres(k), cur = s.cur, C = 2 * Math.PI * 104;
  const monthName = fmt(M.now, { month: 'long', year: 'numeric' }, 'Europe/Paris');
  const rien = !s.steps.length && !s.cumul;
  const split = k === 'qg'
    ? `<span class="tag">France <b>${money(M.resume.fr.cash_mois)}</b></span><span class="tag">USA <b>${money(M.resume.us.cash_mois, 'USD')}</b></span>`
    : `<span class="tag">Signés ce mois <b>${s.signed} / ${s.target == null ? '—' : s.target}</b></span>`;
  const ticks = Array.from({ length: 72 }, (_, i) => { const a = i * 5 * Math.PI / 180, r1 = 124, r2 = i % 6 ? 120 : 116; return `<line x1="${(130 + r1 * Math.cos(a)).toFixed(1)}" y1="${(130 + r1 * Math.sin(a)).toFixed(1)}" x2="${(130 + r2 * Math.cos(a)).toFixed(1)}" y2="${(130 + r2 * Math.sin(a)).toFixed(1)}"/>`; }).join('');
  const p = s.objective ? pct(s.cash, s.objective) : 0;
  const scope = k === 'qg' ? '· deux marchés' : k === 'fr' ? '· France' : '· USA';
  const attenteVide = !s.mrr && !s.attendu.some(e => num(e.engage) || num(e.probable));
  return `<div class="core${rien ? ' cash-zero' : ''}" id="core" style="grid-area:core">
    <div class="core-head"><span class="k"><span class="light" data-s="ok"></span>Cash <span class="core-scope">${scope}</span></span>
      <div class="seg" role="group" aria-label="Vue du cash"><button type="button" data-go="0" aria-current="true">Mois</button><button type="button" data-go="1">Récurrent</button><button type="button" data-go="2">Cumul</button></div></div>
    <div class="slides" id="slides">
      <section class="slide" aria-label="Cash collecté ce mois">
        <div class="ringwrap"><svg viewBox="0 0 260 260" aria-hidden="true"><g class="ticks">${ticks}</g><circle class="ring-bg" cx="130" cy="130" r="104"/>
          <circle class="ring-fg" id="ringFg" cx="130" cy="130" r="104" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" transform="rotate(-90 130 130)" data-target="${(C * (1 - p / 100)).toFixed(1)}"/></svg>
          <div class="ring-center"><span class="k">Cash collecté</span><span class="cash-big" id="cashBig" data-v="${s.cash}" data-cur="${cur}" data-key="${k}">${money(s.cash, cur)}</span><span class="cash-date">depuis le 1ᵉʳ ${esc(monthName)}</span></div></div>
        <div class="core-line"><span class="tag">Objectif <b>${s.objective == null ? 'à calculer' : money(s.objective, cur)}</b></span>${s.objective ? `<span class="tag">Atteint <b>${Math.round(p)} %</b></span>` : ''}${split}</div>
        ${rien ? `<div class="note empty-note" id="cashVide">Aucun paiement pour l’instant. Le cash arrivera ici tout seul : chaque paiement Stripe est enregistré par n8n dans Supabase, et le noyau se met à jour en direct.</div>` : ''}
      </section>
      <section class="slide" aria-label="Récurrent et attendu">
        <div class="slide-title"><div><div class="k">Récurrent signé</div><div class="cash-big">${money(s.mrr, cur)}<span class="k"> /mois</span></div></div><span class="tag">Engagements de 3 mois</span></div>
        ${attenteVide ? `<div class="note empty-note">Aucun abonnement actif pour l’instant. Le récurrent et le cash attendu sur 3 mois apparaîtront dès le premier abonnement Stripe.</div>` : barsSVG(s)}
        <div class="legend"><span><i style="background:var(--cash)"></i>Déjà engagé</span><span><i style="background:repeating-linear-gradient(45deg,var(--cash) 0 2px,transparent 2px 5px);border:1px solid var(--cash)"></i>Probable si le client renouvelle</span></div>
      </section>
      <section class="slide" aria-label="Cumul depuis le début">
        <div class="slide-title"><div><div class="k">Cumul depuis le début</div><div class="cash-big">${money(s.cumul, cur)}</div></div>${s.premier ? `<span class="tag">depuis le ${esc(dayShort(String(s.premier).slice(0, 10)))}</span>` : ''}</div>
        ${s.steps.length ? stepSVG(s) : `<div class="note empty-note">Le cumul démarrera au premier paiement reçu.</div>`}
        ${k === 'qg' ? meterHTML() : partHTML(k)}
      </section>
    </div>
    <div class="core-nav"><button class="arr" type="button" data-step="-1" aria-label="Vue précédente">${svg('left')}</button><div class="pager" aria-hidden="true"><i class="on"></i><i></i><i></i></div><button class="arr" type="button" data-step="1" aria-label="Vue suivante">${svg('right')}</button></div>
  </div>`;
}

function barsSVG(s) {
  const rows = s.attendu.slice(0, 3);
  const W = 320, H = 170, top = 26, bot = 24, max = Math.max(...rows.map(e => num(e.engage) + num(e.probable)), 1);
  const sc = v => (H - top - bot) * v / max, bw = 58, gapX = (W - 3 * bw) / 4;
  const bars = rows.map((e, i) => {
    const eng = num(e.engage), prob = num(e.probable);
    const x = gapX + i * (bw + gapX), he = sc(eng), hp = sc(prob), yE = H - bot - he, yP = yE - hp;
    const m = fmt(String(e.mois).slice(0, 10), { month: 'short' }, 'UTC');
    return `${eng ? `<rect x="${x}" y="${yE}" width="${bw}" height="${he}" rx="5" fill="var(--cash)"/>` : ''}
      ${prob ? `<rect x="${x + .75}" y="${yP + .75}" width="${bw - 1.5}" height="${Math.max(hp - 1.5, 0)}" rx="5" fill="url(#hatch-${s.key})" stroke="var(--cash)" stroke-width="1.5"/>` : ''}
      <text class="val" x="${x + bw / 2}" y="${yP - 7}" text-anchor="middle">${esc(money(eng + prob, s.cur))}</text>
      <text x="${x + bw / 2}" y="${H - 7}" text-anchor="middle">${esc(m.charAt(0).toUpperCase() + m.slice(1))}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cash attendu sur les 3 prochains mois"><defs><pattern id="hatch-${s.key}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="var(--cash)" opacity=".55"/></pattern></defs>
    <line class="axis" x1="0" x2="${W}" y1="${H - bot}" y2="${H - bot}"/>${bars}</svg>`;
}

function stepSVG(s) {
  const W = 320, H = 150, L = 40, R = 12, T = 14, B = 22, jour = 86400000;
  const debut = s.premier ? String(s.premier).slice(0, 10) : s.steps[0][0];
  const t0 = toDate(debut).getTime() - jour * .5;
  let t1 = toDate(ymd(M.now, 'Europe/Paris')).getTime() + jour * .5;
  if (t1 <= t0) t1 = t0 + jour;
  const vmax = Math.max(...s.steps.map(x => x[1]), 1), nice = niceMax(vmax * 1.12);
  const x = t => L + (W - L - R) * (t - t0) / (t1 - t0), y = v => H - B - (H - T - B) * Math.max(v, 0) / nice;
  let d = `M${x(t0)} ${y(0)}`, prev = 0;
  s.steps.forEach(([ds, v]) => { const xx = x(Math.min(toDate(ds).getTime(), t1)); d += ` L${xx.toFixed(1)} ${y(prev).toFixed(1)} L${xx.toFixed(1)} ${y(v).toFixed(1)}`; prev = v; });
  d += ` L${x(t1).toFixed(1)} ${y(prev).toFixed(1)}`;
  const area = d + ` L${x(t1).toFixed(1)} ${y(0)} Z`;
  const grid = [nice / 2, nice].map(v => `<line class="gridl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${esc(short(v, s.cur))}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cash cumulé depuis le début">${grid}
    <line class="axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/><text x="${L - 6}" y="${y(0) + 3}" text-anchor="end">0</text>
    <path d="${area}" fill="var(--cash-soft)"/><path d="${d}" fill="none" stroke="var(--cash)" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${x(t1)}" cy="${y(prev)}" r="4.5" fill="var(--cash)" stroke="var(--surface)" stroke-width="2"/>
    <text x="${L}" y="${H - 6}">${esc(dayShort(debut))}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">aujourd’hui</text></svg>`;
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p; return 10 * p; }
function short(v, cur) { const s = cur === 'USD' ? ' $' : ' €'; return v >= 1000 ? (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k' + s : Math.round(v) + s; }

function meterHTML() {
  const t = M.seuils;
  if (!t) return '<div class="note">Les seuils de TVA et du plafond micro s’afficheront ici dès que la vue v_seuils répondra.</div>';
  const caFr = num(t.ca_france_eur), caAll = num(t.ca_total_eur), base = num(t.tva_base), maj = num(t.tva_majore), micro = num(t.plafond_micro);
  const alerteTva = { proche: ['warn', 'CA France proche du seuil de TVA (80 %).'], base_depassee: ['warn', 'Seuil de TVA de base dépassé : TVA due à partir du 1ᵉʳ janvier.'], tva_due: ['bad', 'Seuil majoré dépassé : TVA due dès maintenant.'] }[t.alerte_tva];
  const alerteMicro = { proche: ['warn', 'CA total proche du plafond micro (80 %).'], depasse: ['bad', 'Plafond micro dépassé.'] }[t.alerte_micro];
  const prorata = num(t.jours_activite) && num(t.jours_annee) && num(t.jours_activite) < num(t.jours_annee);
  return `<div class="meter"><div class="meter-l"><span>CA France (seuil de TVA)</span><span class="mono">${money(caFr)} / ${money(maj)}</span></div>
    <div class="meter-bar"><i style="width:${pct(caFr, maj)}%"></i><em style="left:${pct(base, maj)}%"></em></div>
    <div class="meter-l"><span>Repère : ${money(base)}</span><span>TVA due dès ${money(maj)}</span></div></div>
    <div class="meter"><div class="meter-l"><span>CA total encaissé (plafond micro)</span><span class="mono">${money(caAll)} / ${money(micro)}</span></div>
    <div class="meter-bar"><i style="width:${pct(caAll, micro)}%"></i></div></div>
    ${alerteTva ? `<div class="note ${alerteTva[0]}">${esc(alerteTva[1])}</div>` : ''}${alerteMicro ? `<div class="note ${alerteMicro[0]}">${esc(alerteMicro[1])}</div>` : ''}
    ${prorata ? `<div class="meter-l"><span>Seuils ${esc(t.annee)} au prorata : ${esc(t.jours_activite)} jours d’activité sur ${esc(t.jours_annee)}.</span></div>` : ''}`;
}
function partHTML(k) {
  const tot = num(M.resume.total.cumul_eur), mien = num(M.resume[k].cumul_eur);
  if (!tot) return '';
  return `<div class="note">${k === 'fr' ? 'Part de la France' : 'Part des USA'} dans le total : ${Math.round(mien / tot * 100)} %</div>`;
}

/* ---------- station ---------- */
function headHTML(k) {
  const now = M.now;
  if (k === 'qg') {
    return `<div><h1 class="st-title">QG · les deux marchés</h1><div class="st-sub">Le cash total au centre. Entre dans une station pour ne voir que son marché.</div></div>
    <div class="st-meta"><span class="tag">Paris <b>${clock('Europe/Paris', now)}</b></span><span class="tag">Tampa <b>${clock('America/New_York', now)}</b></span><span class="tag">Austin <b>${clock('America/Chicago', now)}</b></span><span class="tag">Rapport du soir <b data-live="countdown">${countdown(now)}</b></span></div>`;
  }
  const p = PLACE[k];
  const niches = [...new Set(M.clients.filter(c => c.marche === k && c.niche).map(c => String(c.niche).toLowerCase()))].slice(0, 4);
  const open = p.clocks.some(c => { const h = hourIn(c[1], now); return h >= p.call[0] && h < p.call[1]; });
  return `<div><h1 class="st-title">Station ${esc(p.nom)}</h1><div class="st-sub">${esc(p.owner)}${niches.length ? ' · ' + esc(niches.join(', ')) : ''}</div></div>
    <div class="st-meta">${p.clocks.map(c => `<span class="tag">${esc(c[0])} <b>${clock(c[1], now)}</b></span>`).join('')}<span class="tag"><span class="light" data-s="${open ? 'run' : 'idle'}"></span>${open ? 'Créneau d’appel ouvert' : 'Créneau d’appel fermé'} (${p.call[0]} h – ${p.call[1]} h)</span></div>`;
}

function render(k, opts = {}) {
  const soft = !!opts.soft && k === station && !!$('#core');
  if (!soft) slide = 0;
  const avantRing = soft && $('#ringFg') ? $('#ringFg').style.strokeDashoffset : null;
  const avantCash = soft && lastCash && lastCash.key === k ? lastCash.v : 0;
  station = k;
  $$('.switch button').forEach(b => b.setAttribute('aria-selected', b.dataset.st === k ? 'true' : 'false'));
  movePill();
  $('#stationHead').innerHTML = headHTML(k);
  roomsNow = ROOMS[k].map(r => ({ ...r, s: roomState(r, k) }));
  $('#plan').innerHTML = `<svg class="conduits" id="conduits" aria-hidden="true"></svg>` + roomsNow.map((r, i) => roomHTML(r, i, k, soft)).join('') + coreHTML(k);
  const sl = $('#slides'); if (sl && slide) sl.scrollLeft = slide * sl.clientWidth;
  syncPager();
  renderJournal(!!opts.soft);
  const fg = $('#ringFg');
  if (fg && avantRing) { fg.style.transition = 'none'; fg.style.strokeDashoffset = avantRing; void fg.getBoundingClientRect(); fg.style.transition = ''; }
  requestAnimationFrame(() => {
    if (fg) fg.style.strokeDashoffset = fg.dataset.target;
    countUp($('#cashBig'), avantCash);
    drawConduits();
  });
  if (!opts.keepHash) { try { history.replaceState(null, '', location.pathname + location.search + '#' + k); } catch { /* ignoré */ } }
}

function movePill() {
  const b = $('.switch button[aria-selected="true"]'), pill = $('#pill');
  if (!b || !pill) return;
  pill.style.left = b.offsetLeft + 'px'; pill.style.width = b.offsetWidth + 'px';
}

function countUp(el, from = 0) {
  if (!el) return;
  const v = +el.dataset.v, cur = el.dataset.cur;
  lastCash = { key: el.dataset.key, v };
  if (RM || from === v) { el.textContent = money(v, cur); return; }
  const t0 = performance.now(), dur = 1100;
  const tick = t => {
    if (!el.isConnected) return;
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = money(from + (v - from) * e, cur);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------- conduits et paquets ---------- */
const wide = window.matchMedia('(min-width: 1081px)');
function edgePoint(cx, cy, hw, hh, dx, dy) {
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}
function drawConduits() {
  const svgEl = $('#conduits'), plan = $('#plan'), core = $('#core');
  for (const k in endpoints) delete endpoints[k];
  if (!svgEl || !core) return;
  svgEl.innerHTML = '';
  if (!wide.matches) return;
  const pr = plan.getBoundingClientRect(), cr = core.getBoundingClientRect();
  const ccx = cr.left - pr.left + cr.width / 2, ccy = cr.top - pr.top + cr.height / 2;
  svgEl.setAttribute('viewBox', `0 0 ${pr.width} ${pr.height}`);
  let out = '';
  plan.querySelectorAll('.room').forEach(el => {
    const r = el.getBoundingClientRect(), rx = r.left - pr.left + r.width / 2, ry = r.top - pr.top + r.height / 2;
    const dx = ccx - rx, dy = ccy - ry;
    const [x1, y1] = edgePoint(rx, ry, r.width / 2, r.height / 2, dx, dy);
    const [x2, y2] = edgePoint(ccx, ccy, cr.width / 2, cr.height / 2, -dx, -dy);
    const spec = roomsNow.find(x => x.id === el.dataset.room), s = spec ? spec.s : 'idle';
    endpoints[el.dataset.room] = [x1, y1, x2, y2, s];
    out += `<line class="base" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><line class="flow" data-s="${s}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><circle class="port" cx="${x1}" cy="${y1}" r="4"/><circle class="port" cx="${x2}" cy="${y2}" r="4"/>`;
  });
  svgEl.innerHTML = out;
}
function packet(roomId, color = 'var(--accent)') {
  const room = $(`.room[data-room="${roomId}"]`);
  if (room) { room.classList.add('flash'); setTimeout(() => room.classList.remove('flash'), 900); }
  const e = endpoints[roomId], svgEl = $('#conduits');
  if (!e || !svgEl || RM) return;
  const NS = 'http://www.w3.org/2000/svg', c = document.createElementNS(NS, 'circle');
  c.setAttribute('r', '5'); c.setAttribute('class', 'packet'); c.style.fill = color; c.style.color = color;
  svgEl.appendChild(c);
  const [x1, y1, x2, y2] = e, t0 = performance.now(), dur = 1000;
  const step = t => {
    const p = Math.min(1, (t - t0) / dur), q = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    c.setAttribute('cx', x1 + (x2 - x1) * q); c.setAttribute('cy', y1 + (y2 - y1) * q);
    if (p < 1 && c.isConnected) requestAnimationFrame(step);
    else { c.remove(); const core = $('#core'); if (core) { core.classList.remove('pulse'); void core.offsetWidth; core.classList.add('pulse'); } }
  };
  requestAnimationFrame(step);
}

/* ---------- carrousel du cash ---------- */
function goSlide(i) {
  const sl = $('#slides'); if (!sl) return;
  slide = Math.max(0, Math.min(2, i));
  sl.scrollTo({ left: slide * sl.clientWidth, behavior: RM ? 'auto' : 'smooth' });
  syncPager();
}
function syncPager() {
  $$('.pager i').forEach((d, j) => d.classList.toggle('on', j === slide));
  $$('.seg button').forEach((b, j) => b.setAttribute('aria-current', j === slide ? 'true' : 'false'));
  const [prev, next] = $$('.core-nav .arr');
  if (prev) prev.disabled = slide === 0;
  if (next) next.disabled = slide === 2;
}

/* ---------- journal ---------- */
function renderJournal(fresh) {
  const tz = TZ[station];
  const rows = M.journal.filter(j => station === 'qg' || !j.marche || j.marche === station).slice(0, 8);
  const premier = rows[0] && rows[0].id;
  const nouveau = fresh && premier && premier !== renderJournal.dernier;
  renderJournal.dernier = premier;
  $('#journal').innerHTML = rows.length
    ? rows.map((j, i) => `<li class="${nouveau && i === 0 ? 'new' : ''}"><time>${esc(heureCourte(j.cree_le, tz))}</time><span class="who">${esc(agentNom(j.agent))}${j.marche && station === 'qg' ? (j.marche === 'fr' ? ' · FR' : ' · US') : ''}</span><span>${esc(j.texte)}</span></li>`).join('')
    : '<li><time></time><span class="who"></span><span>Rien pour l’instant. Les agents écriront ici ce qu’ils font, en direct.</span></li>';
  if (source.mode === 'demo') onStatutDirect('DEMO');
}
function heureCourte(ts, tz) {
  const d = toDate(ts);
  if (Number.isNaN(d.getTime())) return '';
  return ymd(d, tz) === ymd(M.now, tz) ? hm(d, tz) : dayShort(d, tz);
}

/* =====================================================================
   Panneaux : salle ouverte et messagerie
   ===================================================================== */
function openPanel(html, opts = {}) {
  const p = $('#panel');
  if (p.hidden) panelOpener = document.activeElement;
  p.innerHTML = html; p.hidden = false; $('#scrim').hidden = false;
  if (!opts.keepFocus) { const x = p.querySelector('.x'); if (x) x.focus(); }
}
function closePanel(silencieux) {
  const p = $('#panel'); if (!p) return;
  const etaitOuvert = !p.hidden;
  p.hidden = true; $('#scrim').hidden = true; p.innerHTML = '';
  panelState = null; chat.open = false;
  if (etaitOuvert && !silencieux && panelOpener && panelOpener.isConnected) panelOpener.focus();
  panelOpener = null;
}

const sec = (t, h) => `<div class="sec"><h3>${t}</h3>${h}</div>`;
const rowsHTML = arr => `<div class="rows">${arr.map(r => `<div><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}</div>`;

function decisionHTML(a) {
  const au = autoRow(a.agent, a.type_action), ok = peutDecider(a), id = esc(a.id), b = busy.has(a.id) || !ok ? ' disabled' : '';
  const niveau = au ? (au.verrou ? 'Toujours soumis à validation (verrouillé)' : num(au.niveau) === 2 ? 'Autonome' : num(au.niveau) === 1 ? `Autonome après 5 OK · ${Math.min(num(au.ok_consecutifs), 5)}/5` : 'Toujours demander') : 'Toujours demander';
  const qui = a.marche === 'us' ? 'USA' : a.marche === 'fr' ? 'France' : 'les deux marchés';
  return `<div class="decision" data-item="${id}">
    <div class="decision-top"><span class="chip ${a.marche === 'us' ? 'g' : a.marche === 'fr' ? 'w' : ''}">${esc(typeChip(a.type_action))}</span><span class="t">${esc(a.titre)}<small>${esc(agentNom(a.agent))} · ${esc(qui)} · ${esc(quand(a.cree_le, M.now, TZ[a.marche || 'qg']))} · ${esc(niveau)}</small></span></div>
    ${ok ? `<div class="decision-act"><label class="sr" for="corr-${id}">Correction (facultatif)</label><input id="corr-${id}" data-corr="${id}" maxlength="2000" placeholder="Correction (facultatif)"${b}><button class="ok-btn" data-ok="${id}" type="button"${b}>OK</button><button class="no-btn" data-no="${id}" type="button"${b}>Non</button></div>`
      : `<div class="fine">${a.marche ? 'Décision réservée à la personne de ce marché ou à Jay.' : 'Décision réservée à Jay (admin).'}</div>`}
  </div>`;
}

function autonomieHTML(r) {
  if (!r.agents) return '';
  const lignes = M.autonomie.filter(a => r.agents.includes(a.agent) && (!r.types || r.types(a.type_action)))
    .sort((a, b) => typeLabel(a.type_action).localeCompare(typeLabel(b.type_action), 'fr'));
  if (!lignes.length) return '';
  const admin = estAdmin();
  return sec('Ce que l’agent peut faire seul', `<div class="auto">${lignes.map(a => {
    const n = num(a.niveau), okc = num(a.ok_consecutifs);
    const info = a.verrou ? '<small class="lock">Verrouillé : argent, prix, contrat ou premier message à un client restent toujours soumis à validation.</small>'
      : n < 2 && okc >= 5 ? '<small class="good">5 OK d’affilée : Hermès propose de passer au niveau suivant.</small>'
      : n === 1 ? `<small>${Math.min(okc, 5)} validation${okc > 1 ? 's' : ''} sans correction sur 5</small>` : '';
    return `<div class="auto-row"><span class="lbl">${esc(typeLabel(a.type_action))}${r.agents.length > 1 || r.kind === 'agents' ? ` · ${esc(agentNom(a.agent))}` : ''}</span>
      <div class="lvl" role="group" aria-label="${esc(typeLabel(a.type_action))}">${LEVELS.map((l, j) => `<button type="button" class="chip-btn" data-agent="${esc(a.agent)}" data-type="${esc(a.type_action)}" data-lvl="${j}" aria-pressed="${j === n}"${!admin || (a.verrou && j > 0) ? ' disabled' : ''}>${l}</button>`).join('')}</div>${info}</div>`;
  }).join('')}</div>${admin ? '' : '<div class="note">Seul Jay (admin) peut changer ces niveaux. Tu les vois pour savoir ce que chaque agent fait seul.</div>'}`);
}

function roomPanel(id, opts = {}) {
  const spec = roomsNow.find(r => r.id === id); if (!spec) return;
  if (spec.kind === 'gate') { render(spec.m); window.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' }); return; }
  if (spec.kind === 'hermes') { chatPanel(); return; }
  panelState = { type: 'room', id };
  const k = station, s = chiffres(k), tz = TZ[k];
  let body = '';
  switch (spec.kind) {
    case 'prospect': {
      const a = M.appels[k];
      body = a.total ? sec('Écrans d’appel', rowsHTML(a.screens.map(e => [esc(e.nom), `<span class="mono">${entier(e.left)} à appeler sur ${entier(e.total)}</span>`])))
        + sec('Aujourd’hui', rowsHTML([['Leads appelés', `<span class="mono">${a.today} / ${APPELS_JOUR}</span>`], ['Démos prévues', `<span class="mono">${a.demos.length}</span>`], ['Rappels prévus', `<span class="mono">${a.rappels.length}</span>`]]))
        : vide('Aucun lead pour l’instant', 'Les écrans d’appel sont recopiés chaque soir dans Supabase.');
      body += '<div class="note">Les écrans d’appel sont recopiés chaque soir dans Supabase : les chiffres du jour arrivent après la synchro. L’agent ne cherche de nouveaux leads que sur ta demande, et chaque mission Apify passe par « À valider ».</div>';
      break;
    }
    case 'finance': {
      const o = M.objectifs[k];
      body = sec('Ce mois-ci', rowsHTML([['Cash collecté', `<span class="mono">${money(s.cash, s.cur)}</span>`], ['Objectif de cash', `<span class="mono">${s.objective == null ? 'pas encore calculé' : money(s.objective, s.cur)}</span>`], ['Nouveaux clients', `<span class="mono">${s.signed} / ${s.target == null ? '—' : s.target}</span>`], ['Récurrent signé', `<span class="mono">${money(s.mrr, s.cur)}/mois</span>`]]))
        + sec('Cash attendu', s.attendu.length ? rowsHTML(s.attendu.map(e => [esc(fmt(String(e.mois).slice(0, 10), { month: 'long', year: 'numeric' }, 'UTC')), `<span class="mono">${money(e.engage, s.cur)}${num(e.probable) ? ` <span style="color:var(--ink-3)">+ ${money(e.probable, s.cur)} probable</span>` : ''}</span>`])) : '<div class="note">Aucun abonnement actif.</div>')
        + sec('Depuis le début', rowsHTML([['Cumul encaissé', `<span class="mono">${money(s.cumul, s.cur)}</span>`], ['Premier paiement', esc(s.premier ? dayShort(String(s.premier).slice(0, 10)) : 'pas encore')]]))
        + `<div class="note">${o ? `Objectif calculé par ${esc(o.calcule_par || 'l’agent finance')}. ` : ''}Le cash vient uniquement des paiements Stripe, enregistrés par n8n. ${k === 'fr' ? 'Après les 3 pilotes, toute offre part de la grille 390 / 690 / 1 190 €.' : 'Les prix US sont fixés par Junior.'}</div>`;
      break;
    }
    case 'financeQG': {
      const p = M.partage;
      const lignes = q => q ? rowsHTML([['Cash encaissé', `<span class="mono">${money2(q.cash_eur)}</span>`], ['Cotisations', `<span class="mono">− ${money2(q.cotisations_eur)}</span>`], ['Coûts', `<span class="mono">− ${money2(q.couts_eur)}</span>`], ['<b>Résultat</b>', `<b class="mono">${money2(q.resultat_eur)}</b>`], ['Part de Jay', `<span class="mono">${money2(q.part_jay_eur)}</span>`], ['Part de Junior', `<span class="mono">${money2(q.part_junior_eur)}</span>`]]) : '<div class="note">Pas encore calculé.</div>';
      body = sec('Ce mois-ci', lignes(p.mois)) + (p.annee ? sec('Depuis le 1ᵉʳ janvier', lignes(p.annee)) : '')
        + '<div class="note">On paie d’abord les cotisations et les coûts, puis on partage le résultat à 50/50. Les paiements en dollars sont convertis au taux du jour de chaque paiement.</div>';
      break;
    }
    case 'proposals': {
      const brouillons = pending(k).filter(x => x.agent === 'paperasse');
      body = sec('Suivi des offres', rowsHTML([['Démos prévues', `<span class="mono">${M.appels[k].demos.length}</span>`], ['Brouillons à relire', `<span class="warn">${brouillons.length}</span>`], ['Signés ce mois', `<span class="good">${s.signed}</span>`]]))
        + sec('À relire', brouillons.length ? brouillons.map(decisionHTML).join('<div style="height:6px"></div>') : '<div class="note">Aucun brouillon à relire.</div>');
      break;
    }
    case 'market': {
      const x = M.extras && M.extras.marche && M.extras.marche[k];
      body = x ? sec('Ce que les prospects paient aujourd’hui', rowsHTML(x.lignes.map(r => [esc(r[0]) + (r[2] ? `<br><small style="color:var(--ink-3)">${esc(r[2])}</small>` : ''), `<span class="mono">${esc(r[1])}</span>`])))
        : vide('Pas encore d’étude', 'Le reporter ajoutera ici ce que les prospects paient aujourd’hui.');
      body += '<div class="note">Chaque soir, le reporter croise les réponses d’appel avec des sources externes (prix des agences, études du secteur) avant de juger les prix.</div>';
      break;
    }
    case 'clients': {
      const cl = M.clients.filter(c => c.marche === k);
      body = sec('Contrats en cours', cl.length ? cl.map(c => `<div class="client"><div class="client-top"><b>${esc(c.nom)}</b><span class="chip c">${esc(c.palier || 'Offre')}${c.prix_mensuel != null ? ' · ' + esc(money(c.prix_mensuel, c.devise || s.cur)) + '/mois' : ''}</span></div>
        <div class="bar cash"><i style="width:${pct(num(c.resultat_valeur), num(c.objectif_valeur))}%"></i></div>
        <div class="client-grid"><span>Généré<b>${esc(entier(c.resultat_valeur))} / ${esc(entier(c.objectif_valeur))} ${esc(c.objectif_garantie || '')}</b></span><span>Mise en place<b>${esc(money(c.mise_en_place, c.devise || s.cur))}</b></span><span>Début du contrat<b>${esc(day(c.debut, tz) || '—')}</b></span><span>Fin d’engagement<b>${esc(day(c.fin_engagement, tz) || '—')}</b></span>
        <span>Point mensuel<b>${c.prochain_point ? esc(day(c.prochain_point, tz) + ' · ' + hm(c.prochain_point, tz)) : '—'}</b></span><span>Agenda<b class="${c.point_booke ? 'good' : 'warn'}">${c.point_booke ? 'booké' : 'à booker'}</b></span></div></div>`).join('<div style="height:8px"></div>') : '<div class="note">Aucun client actif pour l’instant.</div>')
        + '<div class="note">Garantie : objectif fixé avec chaque client. S’il n’est pas atteint à la fin des 3 mois, on continue gratuitement jusqu’à l’atteindre.</div>';
      break;
    }
    case 'approve': {
      const items = pending(k);
      body = sec('Décisions en attente', items.length ? items.map(decisionHTML).join('<div style="height:6px"></div>') : '<div class="note">Rien à valider.</div>')
        + '<div class="note">Chaque OK sans correction compte. Après 5 OK d’affilée sur un même type d’action, l’agent peut le faire seul si Jay l’autorise dans sa salle. Une correction ou un refus le fait redescendre d’un niveau. Envoyer de l’argent, changer un prix, signer un contrat ou écrire à un client pour la première fois restent toujours soumis à validation.</div>';
      break;
    }
    case 'agenda': {
      const ev = M.agenda[k];
      body = sec(`À venir · heure ${k === 'fr' ? 'de Paris' : 'de New York (Floride)'}`, ev.length ? rowsHTML(ev.map(e => [esc(e.t), `<span class="mono">${esc(day(e.d, tz))} · ${esc(hm(e.d, tz))}</span>`])) : '<div class="note">Rien de prévu.</div>')
        + `<div class="note">Les points mensuels sont bookés à la date anniversaire du contrat ; les démos et rappels viennent des écrans d’appel.</div>`;
      break;
    }
    case 'report': {
      const r = M.rapport;
      if (r) {
        const v = VERDICTS[r.verdict] || [joli(r.verdict)];
        body = sec(`Rapport du ${esc(dayShort(r.jour))} · 23:00`, rowsHTML([['Verdict', `<b>${esc(v[0])}</b>`]]))
          + sec('Résumé', `<div class="note" style="color:var(--ink-2)">${esc(r.resume)}</div>`)
          + sec('Détail', `<div class="note" style="color:var(--ink-2);white-space:pre-line">${esc(r.contenu)}</div>`);
      } else body = vide('Pas encore de rapport', 'Le premier rapport arrivera ce soir à 23:00.');
      body += '<div class="note">Le rapport arrive chaque soir à 23:00 dans la messagerie Hermès.</div>';
      break;
    }
    case 'research': {
      const p = M.extras && M.extras.pistes;
      body = p ? sec('Pistes en cours', rowsHTML(p.map(x => [`<span class="chip ${x[3] ? 'w' : ''}">${esc(x[0])}</span> ${esc(x[1])}`, `<span class="${x[3] ? 'warn' : 'mono'}">${esc(x[2])}</span>`])))
        : vide('Pas encore de piste', 'Le researcher déposera ses pistes ici. Rien ne change sans ta validation.');
      const a = M.agentMap.researcher;
      if (a && a.derniere_phrase) body += sec('En ce moment', `<div class="note" style="color:var(--ink-2)">${esc(a.derniere_phrase)}</div>`);
      break;
    }
    case 'agents':
      body = M.agents.length ? sec('Agents', rowsHTML(M.agents.map(a => [`<span style="display:inline-flex;align-items:center;gap:8px"><span class="light" data-s="${esc(a.statut)}"></span>${esc(a.nom || agentNom(a.agent))}</span><br><small style="color:var(--ink-3)">${esc(a.derniere_phrase || '')}${a.derniere_execution ? ' · ' + esc(quand(a.derniere_execution, M.now, tz)) : ''}${a.prochaine_execution ? ' · prochaine : ' + esc(quand(a.prochaine_execution, M.now, tz)) : ''}</small>`, `<span class="mono">${num(a.cout_jour_eur) ? esc(num(a.cout_jour_eur).toFixed(2).replace('.', ',')) + ' €' : '—'}</span>`])))
        + `<div class="note">Coût des agents aujourd’hui : ${money2(M.agents.reduce((t, a) => t + num(a.cout_jour_eur), 0))}.</div>`
        : vide('Aucune nouvelle des agents', 'Chaque agent apparaîtra ici dès sa première exécution.');
      break;
  }
  body += autonomieHTML(spec);
  openPanel(`<div class="panel-head"><span class="ico">${svg(spec.kind === 'financeQG' ? 'finance' : spec.kind)}</span><div><h2 id="panelTitle">${esc(spec.name)}</h2><p>${esc(spec.agent)} · ${k === 'qg' ? 'deux marchés' : k === 'fr' ? 'France' : 'USA'}</p></div><button class="x" type="button" aria-label="Fermer">${svg('x')}</button></div><div class="panel-body">${body}</div>`, opts);
}

/* ---------- messagerie Hermès ---------- */
const NOMS = { jay: 'Jay', junior: 'Junior', hermes: 'Hermès', systeme: 'Système' };
function estAMoi(r) {
  if (!profile) return false;
  if (r.auteur_id) return r.auteur_id === profile.id;
  return r.auteur === (profile.role === 'admin' ? 'jay' : 'junior');
}
function chatAdd(r) {
  if (!r || !r.id) return false;
  const neuf = !chat.rows.has(r.id);
  if (neuf && estAMoi(r)) {
    const i = chat.local.findIndex(l => (l.kind === 'pending' || l.kind === 'sent') && l.text === r.contenu);
    if (i >= 0) chat.local.splice(i, 1);
  }
  chat.rows.set(r.id, r);
  return neuf;
}
function msgHTML(r) {
  const tz = TZ[(profile && profile.marche) || 'fr'];
  const moi = estAMoi(r);
  const cls = moi ? 'me' : r.auteur === 'hermes' ? 'h' : r.auteur === 'systeme' ? 'h sys' : 'other';
  const contenu = String(r.contenu || '');
  let corps;
  if (r.type === 'rapport') {
    const [titre, ...reste] = contenu.split('\n');
    corps = `<span class="titre">${esc(titre)}</span><span class="txt">${esc(reste.join('\n'))}</span>`;
  } else corps = `<span class="txt">${esc(contenu)}</span>`;
  const qui = moi ? '' : `<span class="who">${esc(NOMS[r.auteur] || r.auteur)}${r.type === 'alerte' ? ' · alerte' : r.type === 'rapport' ? ' · rapport du soir' : ''}</span>`;
  return `<div class="msg ${cls}${r.type === 'rapport' ? ' rapport' : ''}${neuf('m' + r.id)}" data-msg="${esc(r.id)}">${qui}${corps}<time>${esc(heureMsg(r.cree_le, M.now, tz))}</time></div>`;
}
function localHTML(l) {
  if (l.kind === 'err') return `<div class="msg err${neuf(l.cle)}" role="alert">${esc(l.text)}</div>`;
  return `<div class="msg me${l.kind === 'pending' ? ' pending' : ''}${neuf(l.cle)}"><span class="txt">${esc(l.text)}</span><time>${l.kind === 'pending' ? 'envoi…' : l.kind === 'fail' ? 'non envoyé' : esc(l.time || '')}</time></div>`;
}
// seule une bulle jamais affichée est animée (pas tout le fil à chaque nouveau message)
function neuf(cle) {
  if (chat.affiches.has(cle)) return '';
  chat.affiches.add(cle);
  return chat.premierRendu ? '' : ' neuf';
}
function chatPanel() {
  panelState = { type: 'chat' }; chat.open = true;
  const branche = hermesBranche();
  openPanel(`<div class="panel-head"><span class="ico">${svg('hermes')}</span><div><h2 id="panelTitle">Hermès</h2><p><span class="light" data-s="${branche ? 'online' : 'idle'}" style="display:inline-block;margin-right:6px"></span>${branche ? 'En ligne · centre de contrôle' : 'Pas encore branché'}</p></div><button class="x" type="button" aria-label="Fermer">${svg('x')}</button></div>
    <div class="chat" id="chat" aria-live="polite"></div>
    ${branche ? '' : '<div class="quick"><div class="note">Hermès n’est pas encore branché sur ce cockpit : la clé de son API manque sur le serveur. Les rapports du soir arrivent quand même ici.</div></div>'}
    <div class="quick"><button type="button" class="chip-btn" data-q="Résume la journée"${branche ? '' : ' disabled'}>Résume la journée</button><button type="button" class="chip-btn" data-q="Faut-il changer les prix ?"${branche ? '' : ' disabled'}>Faut-il changer les prix ?</button><button type="button" class="chip-btn" data-q="Combien d’appels reste-t-il ?"${branche ? '' : ' disabled'}>Combien d’appels reste-t-il ?</button></div>
    <form class="composer" id="composer"><label for="chatInput" class="sr">Message à Hermès</label><input id="chatInput" autocomplete="off" maxlength="4000" placeholder="${branche ? 'Écris à Hermès…' : 'Hermès n’est pas encore branché'}"${branche ? '' : ' disabled'}><button class="btn primary" type="submit"${branche ? '' : ' disabled'}>Envoyer</button></form>`);
  renderChat(true);
  marquerLu();
  const i = $('#chatInput'); if (i && !i.disabled) i.focus();
}
function renderChat(forceBas) {
  const c = $('#chat'); if (!c) return;
  const enBas = forceBas || c.scrollHeight - c.scrollTop - c.clientHeight < 80;
  chat.premierRendu = !c.childElementCount;
  // messages de la base et messages locaux (en cours d'envoi, erreurs) triés ensemble par heure
  const items = [...chat.rows.values()].map(r => [ms(r.cree_le), msgHTML(r)])
    .concat(chat.local.map(l => [l.at, localHTML(l)]))
    .sort((a, b) => a[0] - b[0]).slice(-80);
  c.innerHTML = items.length
    ? items.map(x => x[1]).join('') + (chat.sending ? '<div class="msg h typing" aria-label="Hermès écrit"><i></i><i></i><i></i></div>' : '')
    : '<div class="chat-empty">Pas encore de message. Le rapport du soir arrivera ici à 23:00 ; tu peux aussi écrire à Hermès.</div>';
  if (enBas) c.scrollTop = c.scrollHeight;
  if (chat.open) marquerLu();
}
async function sendChat(texte) {
  texte = String(texte || '').trim();
  if (!texte || chat.sending || !hermesBranche()) return;
  if (texte.length > 4000) { toast('Message trop long : 4 000 caractères au maximum.', 'err'); return; }
  const local = { kind: 'pending', cle: 'l' + (++chat.seq), text: texte, at: source.now().getTime(), time: hm(source.now(), TZ[(profile && profile.marche) || 'fr']) };
  chat.local.push(local); chat.sending = true; renderChat(true);
  try {
    const rep = await source.sendMessage(texte, station === 'qg' ? null : station);
    if (chat.local.includes(local)) local.kind = 'sent';
    if (rep.messageId && !chat.rows.has(rep.messageId)) chatAdd({ id: rep.messageId, auteur: 'hermes', auteur_id: null, type: 'message', contenu: rep.reply, cree_le: source.now().toISOString() });
    scheduleRefresh(400);
  } catch (e) {
    if (e.status === 502) { if (chat.local.includes(local)) local.kind = 'sent'; } // le message est enregistré, seule la réponse manque
    else if (chat.local.includes(local)) local.kind = 'fail';
    chat.local.push({ kind: 'err', cle: 'l' + (++chat.seq), text: e.message || 'Le message n’a pas pu partir.', at: source.now().getTime() });
    if (e.status === 401) setTimeout(() => logout(), 1500);
  } finally {
    chat.sending = false; renderChat(true);
  }
}
function nonLus() {
  const vu = store.get('cockpit.chat.vu');
  const limite = vu ? new Date(vu) : new Date(M.now.getTime() - 86400000);
  return [...chat.rows.values()].filter(r => (r.auteur === 'hermes' || r.auteur === 'systeme') && toDate(r.cree_le) > limite).length;
}
function majNonLus() {
  const u = $('#unread'); if (!u || !M) return;
  const n = chat.open ? 0 : nonLus();
  u.textContent = n; u.hidden = !n;
  $('#openChat').setAttribute('aria-label', n ? `Hermès, ${n} message${n > 1 ? 's' : ''} non lu${n > 1 ? 's' : ''}` : 'Hermès');
}
function marquerLu() {
  const dernier = [...chat.rows.values()].reduce((m, r) => Math.max(m, ms(r.cree_le)), 0);
  const vu = store.get('cockpit.chat.vu');
  if (dernier && (!vu || dernier > ms(vu))) store.set('cockpit.chat.vu', new Date(dernier).toISOString());
  majNonLus();
}

/* ---------- décisions et autonomie ---------- */
async function decide(id, ok) {
  const a = M.actions.find(x => x.id === id);
  if (!a || busy.has(id) || !peutDecider(a)) return;
  const champ = $(`[data-corr="${CSS.escape(id)}"]`);
  const correction = champ ? champ.value.trim() : '';
  busy.add(id);
  $$(`[data-item="${CSS.escape(id)}"] button, [data-item="${CSS.escape(id)}"] input`).forEach(b => { b.disabled = true; });
  try {
    await source.decide(id, ok, correction || null);
    $$(`[data-item="${CSS.escape(id)}"]`).forEach(el => el.classList.add('gone'));
    toast(ok ? (correction ? 'Validé avec ta correction.' : 'Validé.') : 'Refusé.', ok ? 'ok' : '');
    await sleep(RM ? 0 : 350);
    M.actions = M.actions.filter(x => x.id !== id);
    busy.delete(id);
    render(station, { soft: true, keepHash: true });
    if (panelState && panelState.type === 'room') roomPanel(panelState.id, { keepFocus: true });
    requestAnimationFrame(() => packet('valider', ok ? 'var(--cash)' : 'var(--alert)')); // après le tracé des conduits
    scheduleRefresh(RM ? 300 : 1200);
  } catch (e) {
    busy.delete(id);
    $$(`[data-item="${CSS.escape(id)}"] button, [data-item="${CSS.escape(id)}"] input`).forEach(b => { b.disabled = false; });
    toast(e.message || 'La décision n’a pas pu être enregistrée.', 'err');
  }
}
async function changerNiveau(btn) {
  if (!estAdmin()) return;
  const agent = btn.dataset.agent, type = btn.dataset.type, niveau = +btn.dataset.lvl;
  const ligne = autoRow(agent, type);
  if (ligne && num(ligne.niveau) === niveau) return;
  btn.parentElement.querySelectorAll('.chip-btn').forEach(b => { b.disabled = true; });
  try {
    const r = await source.setAutonomy(agent, type, niveau);
    M.autonomie = M.autonomie.map(x => (x.agent === agent && x.type_action === type ? { ...x, ...(r || {}), niveau, ok_consecutifs: 0 } : x));
    toast(`${typeLabel(type)} : ${LEVELS[niveau].toLowerCase()}.`, 'ok');
  } catch (e) {
    toast(e.message || 'Le niveau n’a pas pu être changé.', 'err');
  }
  if (panelState && panelState.type === 'room') roomPanel(panelState.id, { keepFocus: true });
}

/* =====================================================================
   Événements
   ===================================================================== */
document.addEventListener('click', e => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest('#fatalRetry')) { location.reload(); return; }
  if (t.closest('#fatalLogout')) { (source ? source.signOut().catch(() => {}) : Promise.resolve()).then(() => { stopApp(); showAuth('login', 'Tu es bien déconnecté.'); }); return; }
  if (t.closest('#forgotLink')) { $('#forgotEmail').value = $('#loginEmail').value.trim(); showAuth('forgot'); return; }
  if (t.closest('#backToLogin')) { showAuth('login'); return; }
  if (!appStarted) return;
  if (t.closest('#logout')) { logout(); return; }
  const tab = t.closest('.switch button'); if (tab) { render(tab.dataset.st); return; }
  const ok = t.closest('[data-ok]'); if (ok) { e.stopPropagation(); decide(ok.dataset.ok, true); return; }
  const no = t.closest('[data-no]'); if (no) { e.stopPropagation(); decide(no.dataset.no, false); return; }
  if (t.closest('[data-corr]')) return;
  const go = t.closest('[data-go]'); if (go) { goSlide(+go.dataset.go); return; }
  const st = t.closest('[data-step]'); if (st) { goSlide(slide + (+st.dataset.step)); return; }
  const lvl = t.closest('[data-lvl]'); if (lvl) { if (!lvl.disabled) changerNiveau(lvl); return; }
  const q = t.closest('[data-q]'); if (q) { sendChat(q.dataset.q); return; }
  if (t.closest('.x') || t === $('#scrim')) { closePanel(); return; }
  if (t.closest('#openChat')) { chatPanel(); return; }
  const room = t.closest('.room'); if (room) { roomPanel(room.dataset.room); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#panel').hidden) { closePanel(); return; }
  const room = e.target.closest && e.target.closest('.room');
  if (room && (e.key === 'Enter' || e.key === ' ') && e.target === room) { e.preventDefault(); roomPanel(room.dataset.room); }
  if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-corr]')) { e.preventDefault(); decide(e.target.dataset.corr, true); }
});
document.addEventListener('submit', e => {
  const id = e.target.id;
  if (id === 'loginForm') onLogin(e);
  else if (id === 'forgotForm') onForgot(e);
  else if (id === 'recoverForm') onRecover(e);
  else if (id === 'composer') { e.preventDefault(); const i = $('#chatInput'); sendChat(i.value); i.value = ''; }
});
document.addEventListener('scroll', e => {
  if (e.target && e.target.id === 'slides') {
    const sl = e.target, i = Math.round(sl.scrollLeft / Math.max(1, sl.clientWidth));
    if (i !== slide) { slide = i; syncPager(); }
  }
}, true);
let rz;
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!appStarted) return; drawConduits(); movePill(); const sl = $('#slides'); if (sl) sl.scrollLeft = slide * sl.clientWidth; }, 120); });
window.addEventListener('hashchange', () => { const k = location.hash.replace('#', ''); if (appStarted && ['fr', 'qg', 'us'].includes(k) && k !== station) render(k, { keepHash: true }); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (appStarted) { drawConduits(); movePill(); } });

boot();
})();
