'use strict';
// Test d'intégration : les lignes produites par les workflows entrent dans la vraie
// migration Supabase (Postgres 16 local, schéma auth simulé), comme le ferait PostgREST
// avec la clé secrète (rôle service_role) : contraintes, triggers et vues de cash.
// Se met en « skip » si Postgres n'est pas disponible.
// Lancer avec : node --test n8n/test/*.test.js

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const m = require('../stripe-mapping.js');
const r = require('../rapport-du-soir.js');
const { fixture, texteFixture, clientPour } = require('./outils.js');

const RACINE = path.join(__dirname, '..', '..');
const STUB = path.join(RACINE, 'supabase', 'tests', 'stub_supabase.sql');
const MIGRATION = path.join(RACINE, 'supabase', 'migrations', '20261003000000_cockpit.sql');
const BASE = 'n8n_test_' + Date.now() + '_' + process.pid;
const TAUX = m.lireTauxBce(texteFixture('ecb-eurofxref-daily.xml')).taux;

function commande(nom) {
  return spawnSync('sh', ['-c', 'command -v ' + nom], { encoding: 'utf8' }).status === 0;
}

// psql en super-utilisateur ; le SQL arrive par l'entrée standard
function psql(base, sql) {
  const args = ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', base];
  const res = process.getuid && process.getuid() === 0
    ? spawnSync('su', ['postgres', '-c', 'psql ' + args.join(' ')], { input: sql, encoding: 'utf8' })
    : spawnSync('psql', ['-U', 'postgres'].concat(args), { input: sql, encoding: 'utf8' });
  if (res.status !== 0) throw new Error('psql : ' + (res.stderr || res.stdout));
  return res.stdout.trim();
}

let disponible = commande('psql');
let raison = disponible ? '' : 'psql introuvable';

before(() => {
  if (!disponible) return;
  try {
    if (commande('pg_lsclusters')) {
      const etat = spawnSync('pg_lsclusters', ['--no-header'], { encoding: 'utf8' }).stdout || '';
      if (!/^16\s+main\s+\d+\s+online/m.test(etat)) spawnSync('pg_ctlcluster', ['16', 'main', 'start'], { encoding: 'utf8' });
    }
    let pret = false;
    for (let i = 0; i < 30 && !pret; i++) {
      try { psql('postgres', 'select 1;'); pret = true; } catch (e) { spawnSync('sleep', ['0.5']); }
    }
    if (!pret) throw new Error('Postgres ne répond pas');
    psql('postgres', 'create database ' + BASE + ';');
    psql(BASE, fs.readFileSync(STUB, 'utf8'));
    psql(BASE, fs.readFileSync(MIGRATION, 'utf8'));
  } catch (erreur) {
    disponible = false;
    raison = erreur.message.slice(0, 200);
  }
});

after(() => {
  if (!commande('psql')) return;
  try { psql('postgres', 'drop database if exists ' + BASE + ' with (force);'); } catch (e) { /* rien */ }
});

function json(valeur) {
  const t = JSON.stringify(valeur);
  assert.ok(t.indexOf('$j$') < 0);
  return '$j$' + t + '$j$::json';
}

// Ce que fait PostgREST pour POST /rest/v1/<table>?on_conflict=<cle> avec Prefer: resolution=…
function sqlEcriture(table, lignes, conflit, resolution) {
  if (!lignes.length) return '';
  const colonnes = Object.keys(lignes[0]);
  const liste = colonnes.join(', ');
  let sql = 'insert into public.' + table + ' (' + liste + ') select ' + liste +
    ' from json_populate_recordset(null::public.' + table + ', ' + json(lignes) + ')';
  if (conflit && resolution === 'ignore') sql += ' on conflict (' + conflit + ') do nothing';
  if (conflit && resolution === 'merge') {
    sql += ' on conflict (' + conflit + ') do update set ' +
      colonnes.filter((c) => c !== conflit).map((c) => c + ' = excluded.' + c).join(', ');
  }
  return sql + ';\n';
}

function sqlStripe(sortie) {
  return sqlEcriture('clients', sortie.clients, 'stripe_customer_id', 'ignore') +
    sqlEcriture('paiements', sortie.paiements, 'stripe_event_id', 'ignore') +
    sqlEcriture('abonnements', sortie.abonnements, 'stripe_subscription_id', 'merge') +
    sqlEcriture('actions', sortie.actions) +
    sqlEcriture('journal', sortie.journal);
}

function commeN8n(sql) {
  return 'set role service_role;\n' + sql + 'reset role;\n';
}

const FIXTURES = [
  'invoice.paid.mensuel-eur.json',
  'invoice.paid.pack-3-mois.json',
  'invoice.paid.usd.json',
  'invoice.payment_failed.json',
  'customer.subscription.updated.cancel_at.json',
  'customer.subscription.deleted.json',
  'charge.refunded.partiel.json',
  'charge.dispute.created.json',
];

function toutesLesEcritures() {
  return FIXTURES.map((nom) => {
    const ev = fixture(nom);
    return sqlStripe(m.transformerEvenementStripe(ev, { client: clientPour(ev), tauxUsdEur: TAUX }));
  }).join('');
}

test('les lignes Stripe entrent dans la vraie base (contraintes, triggers, doublons ignorés)', (t) => {
  if (!disponible) return t.skip('Postgres indisponible : ' + raison);
  // une fiche client existe déjà pour Institut Aurore : la base doit relier ses paiements
  psql(BASE, "insert into public.clients (marche, nom, devise, stripe_customer_id, debut) " +
    "values ('fr', 'Institut Aurore', 'EUR', 'cus_TAu7r0reInst1t', '2026-08-04');");
  psql(BASE, commeN8n(toutesLesEcritures()));
  // Stripe renvoie parfois le même événement : rien ne doit être compté deux fois
  psql(BASE, commeN8n(toutesLesEcritures().replace(/insert into public\.(actions|journal)[^\n]*\n/g, '')));

  const paiements = JSON.parse(psql(BASE,
    "select json_agg(json_build_object('id', stripe_event_id, 'type', type, 'montant', montant, 'eur', montant_eur, " +
    "'client', client_id is not null, 'marche', marche) order by paye_le, stripe_event_id) from public.paiements;"));
  assert.equal(paiements.length, 6);
  const parType = {};
  for (const p of paiements) parType[p.type] = (parType[p.type] || 0) + 1;
  assert.deepEqual(parType, { abonnement: 2, mise_en_place: 1, pack: 1, remboursement: 1, litige: 1 });
  const usd = paiements.find((p) => p.id === 'evt_1SKx9qJ8kR4mTzWQG1owUsd4');
  assert.equal(Number(usd.eur), Number((497 * TAUX).toFixed(2))); // montant_eur calculé par la base
  const aurore = paiements.filter((p) => p.id.startsWith('evt_1SKw3nJ8kR4mTzWQx8Lb2PqA'));
  assert.equal(aurore.length, 2);
  assert.ok(aurore.every((p) => p.client), 'paiements non reliés à la fiche client');

  const abonnements = JSON.parse(psql(BASE,
    "select json_agg(json_build_object('id', stripe_subscription_id, 'statut', statut, 'annule', annule_le is not null, " +
    "'client', client_id is not null) order by stripe_subscription_id) from public.abonnements;"));
  assert.deepEqual(abonnements, [
    { id: 'sub_1RqAu7J8kR4mTzWQAur0re00', statut: 'active', annule: true, client: true },
    { id: 'sub_1S8tQ2J8kR4mTzWQG1owSt01', statut: 'canceled', annule: true, client: true },
  ]);
});

test('n8n crée la fiche des nouveaux clients abonnés, sans écraser une fiche existante', (t) => {
  if (!disponible) return t.skip('Postgres indisponible : ' + raison);
  const clients = JSON.parse(psql(BASE,
    "select json_agg(json_build_object('cus', stripe_customer_id, 'nom', nom, 'marche', marche, 'debut', debut, " +
    "'prix', prix_mensuel) order by stripe_customer_id) from public.clients;"));
  const parId = Object.fromEntries(clients.map((c) => [c.cus, c]));
  // fiche saisie avant (Institut Aurore) : intacte
  assert.equal(parId.cus_TAu7r0reInst1t.debut, '2026-08-04');
  assert.equal(parId.cus_TAu7r0reInst1t.prix, null);
  // fiches créées par n8n : clients abonnés qui ont payé
  assert.ok(parId.cus_TG1owAesthet1c, 'fiche Glow Aesthetics absente');
  assert.equal(parId.cus_TG1owAesthet1c.marche, 'us');
  assert.equal(Number(parId.cus_TG1owAesthet1c.prix), 497);
  // un client en impayé n'a pas de fiche créée par un paiement
  assert.equal(parId.cus_TAte1ierB0isPl, undefined);
  // chaque paiement d'un client qui a une fiche y est relié (dans les deux sens)
  const orphelins = psql(BASE,
    'select count(*) from public.paiements p join public.clients c on c.stripe_customer_id = p.stripe_customer_id ' +
    'where p.client_id is distinct from c.id;');
  assert.equal(orphelins, '0');
});

test('invoice.payment_failed : action en attente, verrouillée, journal écrit par la base', (t) => {
  if (!disponible) return t.skip('Postgres indisponible : ' + raison);
  const action = JSON.parse(psql(BASE,
    "select row_to_json(a) from (select statut, auto, agent, type_action from public.actions " +
    "where type_action = 'relance_impaye') a;"));
  assert.deepEqual(action, { statut: 'en_attente', auto: false, agent: 'finance', type_action: 'relance_impaye' });
  const autonomie = JSON.parse(psql(BASE,
    "select row_to_json(a) from (select niveau, verrou from public.autonomie where agent = 'finance' and type_action = 'relance_impaye') a;"));
  assert.deepEqual(autonomie, { niveau: 0, verrou: true });
  const journal = psql(BASE, "select texte from public.journal where texte like 'À valider : Relancer%';");
  assert.match(journal, /Atelier Bois & Plan/);
});

test('les vues de cash comptent les paiements de n8n', (t) => {
  if (!disponible) return t.skip('Postgres indisponible : ' + raison);
  const resume = JSON.parse(psql(BASE,
    "set role service_role; select json_object_agg(marche, json_build_object('cash', cash_mois, 'eur', cash_mois_eur, 'mrr', mrr)) " +
    "from public.cash_resume_au('2026-10-15 12:00+02');"));
  // France : 390 + 490 + 1 050 − 150 ; USA : 497 − 497 (litige)
  assert.equal(Number(resume.fr.cash), 1780);
  assert.equal(Number(resume.us.cash), 0);
  assert.equal(Number(resume.total.eur), 1780);
  // MRR : seul l'abonnement actif d'Institut Aurore (390 €/mois) compte
  assert.equal(Number(resume.fr.mrr), 390);
  assert.equal(Number(resume.us.mrr), 0);
});

test('« signés ce mois » compte les fiches créées par n8n', (t) => {
  if (!disponible) return t.skip('Postgres indisponible : ' + raison);
  const attendu = JSON.parse(psql(BASE,
    "select json_object_agg(marche, n) from (select marche, count(*) as n from public.clients " +
    "where debut >= '2026-10-01' and debut < '2026-11-01' group by marche) x;")) || {};
  assert.ok(Object.values(attendu).reduce((a, b) => a + b, 0) >= 1, 'aucune fiche créée en octobre');
  const resume = JSON.parse(psql(BASE,
    "set role service_role; select json_object_agg(marche, clients_signes_mois) from public.cash_resume_au('2026-10-15 12:00+02');"));
  assert.equal(resume.fr, attendu.fr || 0);
  assert.equal(resume.us, attendu.us || 0);
  assert.equal(resume.total, (attendu.fr || 0) + (attendu.us || 0));
});

test('les lignes du rapport du soir entrent dans la base, et un 2e passage remplace le rapport', (t) => {
  if (!disponible) return t.skip('Postgres indisponible : ' + raison);
  const reponse = {
    model: 'hermes-agent',
    choices: [{ message: { role: 'assistant', content: JSON.stringify({ verdict: 'ajuster_prix', resume: 'Prix sous le plancher.', contenu: 'Détail.' }) } }],
  };
  const maintenant = '2026-10-04T21:00:05Z';
  const sql = function (sortie) {
    return sqlEcriture('rapports', sortie.rapports, 'jour', 'merge') +
      sqlEcriture('messages', sortie.messages) +
      sqlEcriture('agents_etat', sortie.agents_etat, 'agent', 'merge') +
      sqlEcriture('journal', sortie.journal);
  };
  psql(BASE, commeN8n(sqlEcriture('agents_etat', [r.reporterEnCours(maintenant)], 'agent', 'merge')));
  psql(BASE, commeN8n(sql(r.lireReponseHermes(reponse, { jour: '2026-10-04', maintenant }))));
  reponse.choices[0].message.content = JSON.stringify({ verdict: 'tenir', resume: 'Relu : tenir.', contenu: 'Détail relu.' });
  psql(BASE, commeN8n(sql(r.lireReponseHermes(reponse, { jour: '2026-10-04', maintenant }))));
  psql(BASE, commeN8n(sql(r.lireReponseHermes({ error: { message: 'timeout' } }, { jour: '2026-10-05', maintenant }))));
  const rapports = JSON.parse(psql(BASE, "select json_agg(json_build_object('jour', jour, 'verdict', verdict)) from public.rapports;"));
  assert.deepEqual(rapports, [{ jour: '2026-10-04', verdict: 'tenir' }]);
  const types = psql(BASE, "select string_agg(auteur || ':' || type, ',' order by cree_le, type) from public.messages;");
  assert.deepEqual(types.split(',').sort(), ['hermes:rapport', 'hermes:rapport', 'systeme:alerte']);
  const etat = JSON.parse(psql(BASE, "select row_to_json(a) from (select statut, nom from public.agents_etat where agent = 'reporter') a;"));
  assert.deepEqual(etat, { statut: 'err', nom: 'Rapport du soir' });
});
