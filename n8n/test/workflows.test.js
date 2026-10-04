'use strict';
// Tests des workflows générés : JSON valides, connexions, synchronisation avec les .js,
// et exécution complète dans un mini-simulateur de n8n avec de faux Stripe, BCE,
// Supabase et Hermès.
// Lancer avec : node --test n8n/test/*.test.js

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const build = require('../build.js');
const { executerWorkflow, executerCode } = require('./simulateur.js');
const { fixture, texteFixture, CLIENTS } = require('./outils.js');

const DOSSIER = path.join(__dirname, '..');
const URL_SUPABASE = build.REGLAGES_PAR_DEFAUT.supabaseUrl;

function lireWorkflow(nom) {
  return JSON.parse(fs.readFileSync(path.join(build.DOSSIER_WORKFLOWS, nom), 'utf8'));
}

function noeud(wf, nom) {
  const n = wf.nodes.find((x) => x.name === nom);
  assert.ok(n, 'nœud absent : ' + nom);
  return n;
}

// Faux services : Stripe (clients, charges), BCE, Supabase (lecture des réglages, écritures), Hermès
function fauxServices(o) {
  const options = o || {};
  const appels = [];
  async function http(req) {
    appels.push(req);
    if (req.url === 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml') {
      if (options.bceEnPanne) throw new Error('getaddrinfo ENOTFOUND www.ecb.europa.eu');
      return texteFixture('ecb-eurofxref-daily.xml');
    }
    if (req.url.startsWith('https://api.stripe.com/v1/customers/')) {
      if (options.stripeEnPanne) throw new Error('Request failed with status code 404');
      const id = decodeURIComponent(req.url.split('/').pop());
      if (!CLIENTS[id]) throw new Error('No such customer: ' + id);
      return CLIENTS[id];
    }
    if (req.url.startsWith('https://api.stripe.com/v1/charges/')) return fixture('charge-avec-client.dispute.json');
    if (req.url.startsWith(URL_SUPABASE + '/rest/v1/reglages')) {
      if (options.reglagesVides) return [];
      return [{ valeur: { usd_eur: 0.891, source: 'BCE 2026-10-02' } }];
    }
    if (req.url.startsWith(URL_SUPABASE + '/rest/v1/')) return '';
    if (req.url.endsWith('/v1/chat/completions')) {
      if (options.hermesEnPanne) throw new Error('connect ECONNREFUSED 172.17.0.1:8642');
      return {
        id: 'chatcmpl-1', object: 'chat.completion', model: 'hermes-agent',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
          verdict: 'tenir', resume: 'Journée calme, cap tenu.', contenu: 'France : 80 appels.\nUSA : 40 appels.\nVerdict : tenir.',
        }) } }],
        usage: { total_tokens: 1200 },
      };
    }
    throw new Error('URL inattendue dans le test : ' + req.url);
  }
  return { http, appels };
}

function ecritures(appels, table) {
  return appels.filter((a) => a.methode === 'POST' && a.url.startsWith(URL_SUPABASE + '/rest/v1/' + table));
}

describe('fichiers générés', () => {
  test('les deux JSON se lisent et chaque connexion pointe vers un nœud existant', () => {
    for (const nom of Object.values(build.FICHIERS)) {
      const wf = lireWorkflow(nom);
      assert.deepEqual(build.verifierWorkflow(wf), [], nom);
      const noms = new Set(wf.nodes.map((n) => n.name));
      for (const [source, c] of Object.entries(wf.connections)) {
        assert.ok(noms.has(source), source);
        for (const liste of c.main) for (const lien of liste) assert.ok(noms.has(lien.node), source + ' -> ' + lien.node);
      }
      assert.equal(wf.settings.timezone, 'Europe/Paris');
      assert.equal(wf.settings.executionOrder, 'v1');
      assert.equal(wf.active, false);
    }
  });

  test('les JSON sont à jour : build.js les régénère à l\'identique', () => {
    const attendus = build.generer();
    for (const nom of Object.keys(attendus)) {
      const surDisque = fs.readFileSync(path.join(build.DOSSIER_WORKFLOWS, nom), 'utf8');
      assert.equal(surDisque, build.enJson(attendus[nom]), nom + ' n\'est pas à jour : lance « node n8n/build.js »');
    }
  });

  test('les nœuds Code contiennent le code exact des fichiers .js testés', () => {
    const mapping = fs.readFileSync(path.join(DOSSIER, 'stripe-mapping.js'), 'utf8').trimEnd();
    const rapport = fs.readFileSync(path.join(DOSSIER, 'rapport-du-soir.js'), 'utf8').trimEnd();
    const stripe = lireWorkflow(build.FICHIERS.stripe);
    for (const nom of ['Préparer', 'Transformer']) assert.ok(noeud(stripe, nom).parameters.jsCode.startsWith(mapping + '\n'), nom);
    const soir = lireWorkflow(build.FICHIERS.rapport);
    for (const nom of ['Préparer la demande', 'Lire la réponse']) assert.ok(noeud(soir, nom).parameters.jsCode.startsWith(rapport + '\n'), nom);
  });

  test('stripe-mapping.js collé tel quel dans un nœud Code (bac à sable de n8n) fonctionne', async () => {
    const code = fs.readFileSync(path.join(DOSSIER, 'stripe-mapping.js'), 'utf8') +
      '\nreturn [{ json: transformerEvenementStripe($input.first().json, { client: null, tauxUsdEur: 0.9 }) }];';
    const ev = fixture('invoice.paid.usd.json');
    const sortie = await executerCode(code, { $input: { first: () => ({ json: ev }), all: () => [{ json: ev }] } });
    assert.equal(sortie.length, 1);
    assert.equal(sortie[0].json.paiements[0].montant, 497);
    assert.equal(sortie[0].json.paiements[0].taux_eur, 0.9);
    assert.equal(sortie[0].json.paiements[0].marche, 'us');
  });

  test('un nœud mal relié est détecté par la vérification', () => {
    const wf = build.generer()[build.FICHIERS.stripe];
    wf.connections['Transformer'].main[0][0].node = 'Nœud fantôme';
    const erreurs = build.verifierWorkflow(wf);
    assert.ok(erreurs.some((e) => /nœud inconnu.*Nœud fantôme/.test(e)), erreurs.join('\n'));
    assert.ok(erreurs.some((e) => /jamais atteint : Écrire dans Supabase/.test(e)), erreurs.join('\n'));
  });

  test('les réglages du build viennent des variables d\'environnement', () => {
    const r = build.reglagesDepuisEnv({ SUPABASE_URL: 'https://abcd.supabase.co/', HERMES_MODEL: 'hermes-4' });
    assert.equal(r.supabaseUrl, 'https://abcd.supabase.co');
    assert.equal(r.hermesModel, 'hermes-4');
    assert.equal(r.hermesUrl, 'http://host.docker.internal:8642');
    const wf = build.generer(r)[build.FICHIERS.rapport];
    const valeurs = Object.fromEntries(noeud(wf, 'Réglages').parameters.assignments.assignments.map((a) => [a.name, a.value]));
    assert.deepEqual(valeurs, { supabaseUrl: 'https://abcd.supabase.co', hermesUrl: 'http://host.docker.internal:8642', hermesModel: 'hermes-4' });
  });
});

describe('stripe-vers-supabase : nœuds', () => {
  const wf = lireWorkflow(build.FICHIERS.stripe);

  test('Stripe Trigger : les 7 événements du contrat, identifiant Stripe', () => {
    const t = noeud(wf, 'Stripe');
    assert.equal(t.type, 'n8n-nodes-base.stripeTrigger');
    assert.equal(t.typeVersion, 1);
    assert.deepEqual(t.parameters.events, [
      'invoice.paid', 'invoice.payment_failed', 'customer.subscription.created', 'customer.subscription.updated',
      'customer.subscription.deleted', 'charge.refunded', 'charge.dispute.created',
    ]);
    assert.match(t.parameters.apiVersion, /^\d{4}-\d{2}-\d{2}\.[a-z]+$/);
    assert.match(t.webhookId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(t.credentials, { stripeApi: { id: null, name: build.IDENTIFIANTS.stripe.nom } });
  });

  test('écritures Supabase : URL, on_conflict et Prefer du contrat, clé secrète n8n', () => {
    const attendu = {
      'Créer la fiche client': ['clients?on_conflict=stripe_customer_id', 'resolution=ignore-duplicates,return=minimal'],
      'Enregistrer les paiements': ['paiements?on_conflict=stripe_event_id', 'resolution=ignore-duplicates,return=minimal'],
      'Mettre à jour l\'abonnement': ['abonnements?on_conflict=stripe_subscription_id', 'resolution=merge-duplicates,return=minimal'],
      'Créer l\'action à valider': ['actions', 'return=minimal'],
      'Écrire dans le journal': ['journal', 'return=minimal'],
    };
    for (const [nom, [chemin, prefer]] of Object.entries(attendu)) {
      const n = noeud(wf, nom);
      assert.equal(n.type, 'n8n-nodes-base.httpRequest');
      assert.equal(n.parameters.method, 'POST');
      assert.equal(n.parameters.url, '={{ $(\'Réglages\').first().json.supabaseUrl }}/rest/v1/' + chemin);
      assert.deepEqual(n.parameters.headerParameters.parameters, [{ name: 'Prefer', value: prefer }]);
      assert.equal(n.parameters.genericAuthType, 'httpHeaderAuth');
      assert.equal(n.credentials.httpHeaderAuth.name, build.IDENTIFIANTS.supabase.nom);
      assert.equal(n.retryOnFail, true);
    }
  });
});

describe('stripe-vers-supabase : exécution simulée', () => {
  const wf = lireWorkflow(build.FICHIERS.stripe);

  async function lancer(nomFixture, options) {
    const services = fauxServices(options);
    const ev = typeof nomFixture === 'string' ? fixture(nomFixture) : nomFixture;
    const resultat = await executerWorkflow(wf, { declencheur: ev, http: services.http });
    assert.deepEqual(resultat.erreurs, []);
    return { appels: services.appels, resultat: resultat };
  }

  test('invoice.paid mensuel EUR : lit le client, écrit 2 paiements et 1 ligne de journal', async () => {
    const { appels, resultat } = await lancer('invoice.paid.mensuel-eur.json');
    assert.ok(appels.some((a) => a.url === 'https://api.stripe.com/v1/customers/cus_TAu7r0reInst1t' && a.identifiant === build.IDENTIFIANTS.stripe.nom));
    const paiements = ecritures(appels, 'paiements');
    assert.equal(paiements.length, 1);
    assert.equal(paiements[0].url, URL_SUPABASE + '/rest/v1/paiements?on_conflict=stripe_event_id');
    assert.equal(paiements[0].entetes.Prefer, 'resolution=ignore-duplicates,return=minimal');
    assert.equal(paiements[0].identifiant, build.IDENTIFIANTS.supabase.nom);
    assert.deepEqual(paiements[0].corps.map((p) => [p.type, p.montant, p.marche]), [['abonnement', 390, 'fr'], ['mise_en_place', 490, 'fr']]);
    assert.equal(ecritures(appels, 'journal').length, 1);
    assert.equal(ecritures(appels, 'abonnements').length, 0);
    assert.equal(ecritures(appels, 'actions').length, 0);
    // fiche client créée (jamais écrasée), avant les paiements pour que la base les relie tout de suite
    const fiches = ecritures(appels, 'clients');
    assert.equal(fiches.length, 1);
    assert.equal(fiches[0].url, URL_SUPABASE + '/rest/v1/clients?on_conflict=stripe_customer_id');
    assert.equal(fiches[0].entetes.Prefer, 'resolution=ignore-duplicates,return=minimal');
    assert.deepEqual(fiches[0].corps.map((c) => [c.stripe_customer_id, c.nom, c.marche, c.prix_mensuel]),
      [['cus_TAu7r0reInst1t', 'Institut Aurore', 'fr', 390]]);
    assert.ok(resultat.ordre.indexOf('Créer la fiche client') < resultat.ordre.indexOf('Enregistrer les paiements'));
    // ordre v1 : les paiements sont écrits avant le journal
    assert.ok(resultat.ordre.indexOf('Enregistrer les paiements') < resultat.ordre.indexOf('Écrire dans le journal'));
  });

  test('invoice.paid USD : taux BCE du jour appliqué', async () => {
    const { appels } = await lancer('invoice.paid.usd.json');
    const p = ecritures(appels, 'paiements')[0].corps[0];
    assert.equal(p.devise, 'USD');
    assert.equal(p.marche, 'us');
    assert.equal(p.taux_eur, 0.890869);
  });

  test('BCE en panne : taux de secours lu dans Supabase ; tout en panne : dernier recours', async () => {
    const secours = await lancer('invoice.paid.usd.json', { bceEnPanne: true });
    assert.equal(ecritures(secours.appels, 'paiements')[0].corps[0].taux_eur, 0.891);
    const rien = await lancer('invoice.paid.usd.json', { bceEnPanne: true, reglagesVides: true });
    assert.equal(ecritures(rien.appels, 'paiements')[0].corps[0].taux_eur, require('../stripe-mapping.js').TAUX_USD_EUR_DERNIER_RECOURS);
  });

  test('client Stripe illisible : le paiement passe quand même, marché selon la devise', async () => {
    const ev = fixture('invoice.paid.usd.json');
    const { appels } = await lancer(ev, { stripeEnPanne: true });
    const p = ecritures(appels, 'paiements')[0].corps[0];
    assert.equal(p.marche, 'us');
    assert.equal(p.stripe_customer_id, 'cus_TG1owAesthet1c');
  });

  test('invoice.payment_failed : seulement une action à valider', async () => {
    const { appels } = await lancer('invoice.payment_failed.json');
    const actions = ecritures(appels, 'actions');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].corps[0].type_action, 'relance_impaye');
    assert.equal(ecritures(appels, 'paiements').length, 0);
    assert.equal(ecritures(appels, 'journal').length, 0);
    assert.equal(ecritures(appels, 'abonnements').length, 0);
  });

  test('customer.subscription.updated : upsert de l\'abonnement et journal', async () => {
    const { appels } = await lancer('customer.subscription.updated.cancel_at.json');
    const abo = ecritures(appels, 'abonnements');
    assert.equal(abo.length, 1);
    assert.equal(abo[0].url, URL_SUPABASE + '/rest/v1/abonnements?on_conflict=stripe_subscription_id');
    assert.equal(abo[0].entetes.Prefer, 'resolution=merge-duplicates,return=minimal');
    assert.equal(abo[0].corps[0].annule_le, '2027-01-04T07:12:00.000Z');
    assert.equal(ecritures(appels, 'journal').length, 1);
  });

  test('charge.dispute.created : lit la charge avec son client, écrit un litige', async () => {
    const { appels } = await lancer('charge.dispute.created.json');
    assert.ok(appels.some((a) => a.url === 'https://api.stripe.com/v1/charges/ch_3SKx9oJ8kR4mTzWQ0G1owAe1?expand[]=customer'));
    const p = ecritures(appels, 'paiements')[0].corps[0];
    assert.equal(p.type, 'litige');
    assert.equal(p.montant, -497);
    assert.equal(p.stripe_customer_id, 'cus_TG1owAesthet1c');
  });

  test('charge sans client : le nœud « Lire le client Stripe » ne tourne pas', async () => {
    const ev = fixture('charge.refunded.partiel.json');
    ev.data.object.customer = null;
    const { appels, resultat } = await lancer(ev);
    assert.equal(resultat.ordre.includes('Lire le client Stripe'), false);
    assert.equal(appels.some((a) => a.url.startsWith('https://api.stripe.com/')), false);
    assert.equal(ecritures(appels, 'paiements')[0].corps[0].montant, -150);
  });

  test('événement sans rien à écrire : aucune écriture dans Supabase', async () => {
    const { appels } = await lancer({ id: 'evt_x', type: 'customer.created', data: { object: { id: 'cus_x', customer: null } } });
    assert.equal(appels.filter((a) => a.methode === 'POST').length, 0);
  });
});

describe('rapport-du-soir : nœuds et exécution simulée', () => {
  const wf = lireWorkflow(build.FICHIERS.rapport);

  test('Schedule Trigger à 23:00, fuseau Europe/Paris dans les réglages du workflow', () => {
    const t = noeud(wf, 'Chaque soir à 23 h');
    assert.equal(t.type, 'n8n-nodes-base.scheduleTrigger');
    assert.deepEqual(t.parameters.rule.interval, [{ field: 'days', daysInterval: 1, triggerAtHour: 23, triggerAtMinute: 0 }]);
    assert.equal(wf.settings.timezone, 'Europe/Paris');
  });

  test('Hermès : POST /v1/chat/completions avec la clé Hermès (Bearer)', () => {
    const h = noeud(wf, 'Demander à Hermès');
    assert.equal(h.parameters.method, 'POST');
    assert.equal(h.parameters.url, '={{ $(\'Réglages\').first().json.hermesUrl }}/v1/chat/completions');
    assert.equal(h.parameters.genericAuthType, 'httpBearerAuth');
    assert.equal(h.credentials.httpBearerAuth.name, build.IDENTIFIANTS.hermes.nom);
    assert.equal(h.onError, 'continueRegularOutput');
  });

  test('réponse JSON : rapport, message, état de l\'agent, journal', async () => {
    const services = fauxServices();
    const resultat = await executerWorkflow(wf, { declencheur: { timestamp: '2026-10-04T23:00:00+02:00' }, http: services.http });
    assert.deepEqual(resultat.erreurs, []);
    const appels = services.appels;
    const demande = appels.find((a) => a.url === 'http://host.docker.internal:8642/v1/chat/completions');
    assert.ok(demande, 'Hermès non appelé');
    assert.equal(demande.identifiant, build.IDENTIFIANTS.hermes.nom);
    assert.equal(demande.corps.model, 'hermes-agent');
    assert.equal(demande.corps.stream, false);
    const etats = ecritures(appels, 'agents_etat');
    assert.equal(etats.length, 2);
    assert.equal(etats[0].corps[0].statut, 'run');
    assert.equal(etats[1].corps[0].statut, 'ok');
    assert.equal(etats[1].url, URL_SUPABASE + '/rest/v1/agents_etat?on_conflict=agent');
    const rapports = ecritures(appels, 'rapports');
    assert.equal(rapports.length, 1);
    assert.equal(rapports[0].url, URL_SUPABASE + '/rest/v1/rapports?on_conflict=jour');
    assert.equal(rapports[0].corps[0].verdict, 'tenir');
    const messages = ecritures(appels, 'messages');
    assert.equal(messages[0].corps[0].type, 'rapport');
    assert.equal(messages[0].corps[0].auteur, 'hermes');
    assert.equal(ecritures(appels, 'journal').length, 1);
    // l'appel « en cours » se fait avant Hermès
    assert.ok(appels.indexOf(etats[0]) < appels.indexOf(demande));
  });

  test('Hermès en panne : alerte dans la messagerie, agent en erreur, pas de rapport', async () => {
    const services = fauxServices({ hermesEnPanne: true });
    const resultat = await executerWorkflow(wf, { declencheur: {}, http: services.http });
    assert.deepEqual(resultat.erreurs, []);
    assert.equal(ecritures(services.appels, 'rapports').length, 0);
    const message = ecritures(services.appels, 'messages')[0].corps[0];
    assert.equal(message.type, 'alerte');
    assert.equal(message.auteur, 'systeme');
    assert.match(message.contenu, /ECONNREFUSED/);
    const etats = ecritures(services.appels, 'agents_etat');
    assert.equal(etats[etats.length - 1].corps[0].statut, 'err');
  });
});
