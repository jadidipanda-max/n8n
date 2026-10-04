'use strict';
// Tests de stripe-mapping.js : événements Stripe réalistes -> lignes Supabase.
// Lancer avec : node --test n8n/test/*.test.js

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const m = require('../stripe-mapping.js');
const { fixture, texteFixture, clientPour, colonnesMigration, verifierColonnes, CLIENTS } = require('./outils.js');

const TAUX_BCE = m.lireTauxBce(texteFixture('ecb-eurofxref-daily.xml'));
const TABLES = colonnesMigration();

// Colonnes écrites par n8n (contrat 1.2) : client_id est relié par la base, montant_eur est calculé
const COLONNES_PAIEMENT = ['stripe_event_id', 'stripe_invoice_id', 'stripe_customer_id', 'marche', 'type',
  'montant', 'devise', 'taux_eur', 'paye_le', 'description'];
const COLONNES_ABONNEMENT = ['stripe_subscription_id', 'stripe_customer_id', 'marche', 'statut', 'montant',
  'devise', 'intervalle_mois', 'debut', 'fin_engagement', 'prochaine_facture', 'annule_le'];
const COLONNES_JOURNAL = ['marche', 'agent', 'texte'];
const COLONNES_ACTION = ['marche', 'agent', 'type_action', 'titre', 'details'];
const COLONNES_CLIENT = ['stripe_customer_id', 'marche', 'nom', 'devise', 'prix_mensuel', 'debut', 'fin_engagement'];
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function transformer(nom, options) {
  const ev = typeof nom === 'string' ? fixture(nom) : nom;
  const o = options || {};
  const client = 'client' in o ? o.client : clientPour(ev);
  const taux = 'taux' in o ? o.taux : TAUX_BCE.taux;
  return m.transformerEvenementStripe(ev, { client: client, tauxUsdEur: taux });
}

function sansEspaces(t) {
  return String(t).replace(/[\s  ]/g, '');
}

function centimes(montant) {
  return Math.round(montant * 100);
}

// Vérifie la forme de toutes les lignes produites (colonnes exactes, types)
function verifierForme(sortie) {
  assert.deepEqual(Object.keys(sortie).sort(), ['abonnements', 'actions', 'clients', 'journal', 'paiements']);
  for (const c of sortie.clients) {
    assert.deepEqual(Object.keys(c).sort(), COLONNES_CLIENT.slice().sort());
    assert.match(c.stripe_customer_id, /^cus_/);
    assert.ok(['fr', 'us'].includes(c.marche));
    assert.ok(['EUR', 'USD'].includes(c.devise));
    assert.ok(c.nom && typeof c.nom === 'string');
    assert.match(c.debut, JOUR);
    if (c.fin_engagement !== null) assert.match(c.fin_engagement, JOUR);
  }
  for (const p of sortie.paiements) {
    assert.deepEqual(Object.keys(p).sort(), COLONNES_PAIEMENT.slice().sort());
    assert.ok(m.TYPES_PAIEMENT.includes(p.type), 'type inconnu : ' + p.type);
    assert.ok(['fr', 'us'].includes(p.marche));
    assert.ok(['EUR', 'USD'].includes(p.devise));
    assert.equal(typeof p.montant, 'number');
    assert.ok(Math.abs(p.montant * 100 - Math.round(p.montant * 100)) < 1e-6, '2 décimales au plus');
    assert.ok(p.taux_eur > 0);
    assert.match(p.paye_le, ISO);
    assert.match(p.stripe_event_id, /^evt_/);
    if (p.type === 'remboursement' || p.type === 'litige') assert.ok(p.montant < 0, 'négatif attendu');
    else assert.ok(p.montant > 0, 'positif attendu');
  }
  for (const a of sortie.abonnements) {
    assert.deepEqual(Object.keys(a).sort(), COLONNES_ABONNEMENT.slice().sort());
    assert.ok(Number.isInteger(a.intervalle_mois) && a.intervalle_mois >= 1);
  }
  for (const j of sortie.journal) assert.deepEqual(Object.keys(j).sort(), COLONNES_JOURNAL.slice().sort());
  for (const a of sortie.actions) assert.deepEqual(Object.keys(a).sort(), COLONNES_ACTION.slice().sort());
  verifierColonnes(assert, TABLES, 'paiements', sortie.paiements);
  verifierColonnes(assert, TABLES, 'abonnements', sortie.abonnements);
  verifierColonnes(assert, TABLES, 'journal', sortie.journal);
  verifierColonnes(assert, TABLES, 'actions', sortie.actions);
  verifierColonnes(assert, TABLES, 'clients', sortie.clients);
}

// Convertit une facture « forme récente » (basil et après) en « forme ancienne » (acacia)
function versAncienneForme(evenement, recurrences) {
  const ev = JSON.parse(JSON.stringify(evenement));
  const f = ev.data.object;
  ev.api_version = '2024-06-20';
  f.subscription = f.parent && f.parent.subscription_details ? f.parent.subscription_details.subscription : null;
  delete f.parent;
  f.lines.data = f.lines.data.map(function (l) {
    const p = l.parent;
    const abo = p.type === 'subscription_item_details';
    const d = abo ? p.subscription_item_details : p.invoice_item_details;
    const prixId = l.pricing.price_details.price;
    const recurrence = recurrences[prixId] || null;
    const nouvelle = Object.assign({}, l, {
      type: abo ? 'subscription' : 'invoiceitem',
      subscription: d.subscription,
      subscription_item: abo ? d.subscription_item : null,
      invoice_item: abo ? null : d.invoice_item,
      proration: d.proration,
      price: { id: prixId, object: 'price', type: recurrence ? 'recurring' : 'one_time', recurring: recurrence,
        unit_amount: Number(l.pricing.unit_amount_decimal), currency: l.currency, metadata: {} },
      tax_amounts: [],
    });
    delete nouvelle.parent;
    delete nouvelle.pricing;
    delete nouvelle.taxes;
    delete nouvelle.pretax_credit_amounts;
    return nouvelle;
  });
  return ev;
}

// Convertit une facture « forme ancienne » en « forme récente » (le prix n'est plus qu'un identifiant)
function versNouvelleForme(evenement) {
  const ev = JSON.parse(JSON.stringify(evenement));
  const f = ev.data.object;
  ev.api_version = '2026-08-26.dahlia';
  f.parent = { type: 'subscription_details', quote_details: null, subscription_details: { metadata: {}, subscription: f.subscription } };
  for (const cle of ['subscription', 'subscription_details', 'charge', 'payment_intent', 'paid', 'paid_out_of_band', 'discount']) delete f[cle];
  f.lines.data = f.lines.data.map(function (l) {
    const nouvelle = {
      id: l.id, object: 'line_item', amount: l.amount, currency: l.currency, description: l.description,
      discount_amounts: l.discount_amounts, discountable: l.discountable, discounts: l.discounts, livemode: l.livemode,
      metadata: l.metadata, period: l.period, pretax_credit_amounts: [], quantity: l.quantity, taxes: [],
      parent: {
        type: 'subscription_item_details', invoice_item_details: null,
        subscription_item_details: { invoice_item: null, proration: false, proration_details: { credited_items: null },
          subscription: l.subscription, subscription_item: l.subscription_item },
      },
      pricing: { type: 'price_details', price_details: { price: l.price.id, product: l.price.product }, unit_amount_decimal: String(l.price.unit_amount) },
    };
    return nouvelle;
  });
  return ev;
}

describe('invoice.paid', () => {
  test('mensuel EUR avec mise en place : une ligne abonnement et une ligne mise_en_place', () => {
    const ev = fixture('invoice.paid.mensuel-eur.json');
    const s = transformer(ev);
    verifierForme(s);
    assert.equal(s.paiements.length, 2);
    const [abo, mep] = s.paiements;
    assert.equal(abo.type, 'abonnement');
    assert.equal(abo.montant, 390);
    assert.equal(mep.type, 'mise_en_place');
    assert.equal(mep.montant, 490);
    // identifiants uniques et stables : la base ignore les doublons sur stripe_event_id
    assert.equal(abo.stripe_event_id, ev.id);
    assert.equal(mep.stripe_event_id, ev.id + ':mise_en_place');
    for (const p of s.paiements) {
      assert.equal(p.marche, 'fr');
      assert.equal(p.devise, 'EUR');
      assert.equal(p.taux_eur, 1);
      assert.equal(p.stripe_invoice_id, 'in_1SKw3kJ8kR4mTzWQ5vNfH2aZ');
      assert.equal(p.stripe_customer_id, 'cus_TAu7r0reInst1t');
      assert.equal(p.paye_le, '2026-10-04T07:12:05.000Z');
      assert.match(p.description, /JSQ-2026-0021/);
    }
    // la somme suit exactement ce que Stripe a encaissé
    assert.equal(centimes(abo.montant + mep.montant), ev.data.object.amount_paid);
    assert.equal(s.abonnements.length, 0);
    assert.equal(s.actions.length, 0);
    assert.equal(s.journal.length, 1);
    assert.equal(s.journal[0].agent, 'finance');
    assert.equal(s.journal[0].marche, 'fr');
    assert.match(sansEspaces(s.journal[0].texte), /Paiementreçu:InstitutAurore,880€/);
  });

  test('même résultat avec la forme ancienne des factures (price.recurring, invoice.subscription)', () => {
    const recent = fixture('invoice.paid.mensuel-eur.json');
    const ancien = versAncienneForme(recent, {
      price_1S0k1zJ8kR4mTzWQEss390m: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    });
    assert.equal(ancien.data.object.parent, undefined);
    assert.equal(ancien.data.object.lines.data[1].price.recurring.interval_count, 1);
    assert.deepEqual(transformer(ancien), transformer(recent));
  });

  test('pack 3 mois (forme ancienne) : type pack, montant de la facture', () => {
    const ev = fixture('invoice.paid.pack-3-mois.json');
    assert.equal(ev.data.object.lines.data[0].price.recurring.interval_count, 3);
    const s = transformer(ev);
    verifierForme(s);
    assert.equal(s.paiements.length, 1);
    const p = s.paiements[0];
    assert.equal(p.type, 'pack');
    assert.equal(p.montant, 1050);
    assert.equal(p.stripe_event_id, ev.id);
    assert.equal(p.marche, 'fr'); // metadata.marche = « FR  » : nettoyé
    assert.equal(p.paye_le, '2026-10-04T07:13:15.000Z');
    assert.match(sansEspaces(s.journal[0].texte), /1050€\(pack3mois\)/);
  });

  test('pack 3 mois (forme récente, prix non déplié) : la durée vient de la période de la ligne', () => {
    const ev = versNouvelleForme(fixture('invoice.paid.pack-3-mois.json'));
    assert.equal(typeof ev.data.object.lines.data[0].pricing.price_details.price, 'string');
    const s = transformer(ev);
    verifierForme(s);
    assert.equal(s.paiements[0].type, 'pack');
    assert.equal(s.paiements[0].montant, 1050);
  });

  test('USD : marché us, taux BCE du jour (euros pour 1 dollar)', () => {
    const s = transformer('invoice.paid.usd.json');
    verifierForme(s);
    assert.equal(s.paiements.length, 1);
    const p = s.paiements[0];
    assert.equal(p.type, 'abonnement');
    assert.equal(p.montant, 497);
    assert.equal(p.devise, 'USD');
    assert.equal(p.marche, 'us');
    assert.equal(p.taux_eur, 0.890869); // 1 / 1,1225
    assert.match(sansEspaces(s.journal[0].texte), /GlowAesthetics,497\$/);
  });

  test('marché : metadata.marche du client Stripe en priorité, sinon la devise', () => {
    const ev = fixture('invoice.paid.usd.json');
    assert.equal(transformer(ev, { client: null }).paiements[0].marche, 'us');
    const clientFr = Object.assign({}, CLIENTS.cus_TG1owAesthet1c, { metadata: { marche: 'fr' } });
    assert.equal(transformer(ev, { client: clientFr }).paiements[0].marche, 'fr');
    const eur = fixture('invoice.paid.mensuel-eur.json');
    const clientUs = Object.assign({}, CLIENTS.cus_TAu7r0reInst1t, { metadata: { marche: 'us' } });
    assert.equal(transformer(eur, { client: clientUs }).paiements[0].marche, 'us');
    assert.equal(transformer(eur, { client: null }).paiements[0].marche, 'fr');
    const sansMarche = Object.assign({}, CLIENTS.cus_TAu7r0reInst1t, { metadata: { marche: 'canada' } });
    assert.equal(transformer(eur, { client: sansMarche }).paiements[0].marche, 'fr');
  });

  test('taux de change : réglage de secours, puis dernier recours', () => {
    const ev = fixture('invoice.paid.usd.json');
    const secours = m.lireTauxSecours([{ valeur: { usd_eur: 0.891, source: 'BCE 2026-10-02' } }]);
    assert.deepEqual(secours, { taux: 0.891, source: 'réglage BCE 2026-10-02' });
    assert.equal(transformer(ev, { taux: secours.taux }).paiements[0].taux_eur, 0.891);
    assert.equal(transformer(ev, { taux: null }).paiements[0].taux_eur, m.TAUX_USD_EUR_DERNIER_RECOURS);
    assert.equal(transformer(ev, { taux: 'n/a' }).paiements[0].taux_eur, m.TAUX_USD_EUR_DERNIER_RECOURS);
    assert.equal(m.lireTauxSecours([]), null);
    assert.equal(m.lireTauxSecours({ error: { message: '401' } }), null);
    assert.equal(m.lireTauxSecours({ valeur: { usd_eur: 0.9 } }).taux, 0.9);
  });

  test('remise sur une ligne : montants nets, somme égale à amount_paid', () => {
    const ev = fixture('invoice.paid.mensuel-eur.json');
    const f = ev.data.object;
    f.lines.data[0].discount_amounts = [{ amount: 9000, discount: 'di_1SKw3jJ8kR4mTzWQPil0te' }];
    f.lines.data[0].pretax_credit_amounts = [{ amount: 9000, discount: 'di_1SKw3jJ8kR4mTzWQPil0te', type: 'discount' }];
    f.amount_paid = 79000;
    const s = transformer(ev);
    verifierForme(s);
    const parType = Object.fromEntries(s.paiements.map((p) => [p.type, p.montant]));
    assert.deepEqual(parType, { abonnement: 390, mise_en_place: 400 });
  });

  test('solde client déduit : la ligne principale absorbe l\'écart, le total reste juste', () => {
    const ev = fixture('invoice.paid.mensuel-eur.json');
    ev.data.object.starting_balance = -5000;
    ev.data.object.amount_paid = 83000;
    const s = transformer(ev);
    verifierForme(s);
    assert.equal(centimes(s.paiements.reduce((t, p) => t + p.montant, 0)), 83000);
    assert.equal(s.paiements[0].montant, 340);
  });

  test('ligne ponctuelle hors abonnement : ponctuel, ou mise_en_place si la description le dit', () => {
    const ev = fixture('invoice.paid.mensuel-eur.json');
    const f = ev.data.object;
    f.parent = null;
    f.billing_reason = 'manual';
    f.lines.data = [f.lines.data[0]];
    f.lines.data[0].parent.invoice_item_details.subscription = null;
    f.lines.data[0].description = 'Atelier photo produits';
    f.amount_paid = 49000;
    assert.equal(transformer(ev).paiements[0].type, 'ponctuel');
    f.lines.data[0].description = 'Frais de mise en place';
    assert.equal(transformer(ev).paiements[0].type, 'mise_en_place');
  });

  test('ligne ponctuelle sur une facture de renouvellement : ponctuel', () => {
    const ev = fixture('invoice.paid.mensuel-eur.json');
    ev.data.object.billing_reason = 'subscription_cycle';
    ev.data.object.lines.data[0].description = 'Shooting vidéo supplémentaire';
    const types = transformer(ev).paiements.map((p) => p.type);
    assert.deepEqual(types, ['abonnement', 'ponctuel']);
  });

  test('metadata.type_paiement force le type d\'une ligne', () => {
    const ev = fixture('invoice.paid.mensuel-eur.json');
    ev.data.object.lines.data[0].metadata = { type_paiement: 'ponctuel' };
    assert.deepEqual(transformer(ev).paiements.map((p) => p.type), ['abonnement', 'ponctuel']);
    ev.data.object.lines.data[0].metadata = { type_paiement: 'litige' }; // refusé : pas un encaissement
    assert.deepEqual(transformer(ev).paiements.map((p) => p.type), ['abonnement', 'mise_en_place']);
  });

  test('facture à 0 (essai gratuit) : aucun paiement, une ligne de journal', () => {
    const ev = fixture('invoice.paid.mensuel-eur.json');
    ev.data.object.amount_paid = 0;
    const s = transformer(ev);
    verifierForme(s);
    assert.equal(s.paiements.length, 0);
    assert.equal(s.journal.length, 1);
    assert.match(s.journal[0].texte, /rien à ajouter au cash/);
  });

  test('devise non gérée : aucun paiement, explication dans le journal', () => {
    const ev = fixture('invoice.paid.mensuel-eur.json');
    ev.data.object.currency = 'gbp';
    const s = transformer(ev);
    assert.equal(s.paiements.length, 0);
    assert.match(s.journal[0].texte, /GBP ignoré/);
  });

  test('mode test de Stripe : signalé dans la description et le journal', () => {
    const ev = fixture('invoice.paid.usd.json');
    ev.livemode = false;
    ev.data.object.livemode = false;
    const s = transformer(ev);
    assert.match(s.paiements[0].description, /\(test\)$/);
    assert.match(s.journal[0].texte, /\(test\)$/);
  });
});

describe('invoice.payment_failed', () => {
  test('crée une action relance_impaye verrouillée, et rien d\'autre', () => {
    const ev = fixture('invoice.payment_failed.json');
    const s = transformer(ev);
    verifierForme(s);
    assert.equal(s.paiements.length, 0);
    assert.equal(s.abonnements.length, 0);
    assert.equal(s.journal.length, 0); // la base écrit « À valider : … » elle-même
    assert.equal(s.actions.length, 1);
    const a = s.actions[0];
    assert.equal(a.type_action, 'relance_impaye');
    assert.equal(a.agent, 'finance');
    assert.equal(a.marche, 'fr');
    assert.equal(a.details.verrou, true);
    assert.equal(a.details.montant, 690);
    assert.equal(a.details.devise, 'EUR');
    assert.equal(a.details.stripe_invoice_id, 'in_1SKwFcJ8kR4mTzWQB0isPlan');
    assert.equal(a.details.stripe_event_id, ev.id);
    assert.equal(a.details.stripe_subscription_id, 'sub_1S5aB0J8kR4mTzWQB0isPl01');
    assert.equal(a.details.prochaine_tentative, '2026-10-07T10:13:25.000Z');
    assert.match(a.details.lien_facture, /^https:\/\/invoice\.stripe\.com\//);
    assert.match(sansEspaces(a.titre), /RelancerAtelierBois&Plan:factureJSQ-2026-0024impayée\(690€\)/);
    // l'action ne porte aucun champ de décision : la file « À valider » s'en charge
    assert.equal('statut' in a, false);
    assert.equal('auto' in a, false);
  });

  test('2e échec : le numéro de tentative apparaît dans le titre', () => {
    const ev = fixture('invoice.payment_failed.json');
    ev.data.object.attempt_count = 2;
    assert.match(transformer(ev).actions[0].titre, /2ᵉ échec/);
  });
});

describe('customer.subscription.*', () => {
  test('updated avec cancel_at : résiliation programmée, engagement de 3 mois par défaut', () => {
    const s = transformer('customer.subscription.updated.cancel_at.json');
    verifierForme(s);
    assert.equal(s.paiements.length, 0);
    assert.equal(s.abonnements.length, 1);
    assert.deepEqual(s.abonnements[0], {
      stripe_subscription_id: 'sub_1RqAu7J8kR4mTzWQAur0re00',
      stripe_customer_id: 'cus_TAu7r0reInst1t',
      marche: 'fr',
      statut: 'active',
      montant: 390,
      devise: 'EUR',
      intervalle_mois: 1,
      debut: '2026-08-04T07:12:00.000Z',
      fin_engagement: '2026-11-04T07:12:00.000Z',
      prochaine_facture: '2026-11-04T07:12:00.000Z', // items.data[].current_period_end (API récente)
      annule_le: '2027-01-04T07:12:00.000Z', // cancel_at
    });
    assert.equal(s.journal.length, 1);
    assert.equal(s.journal[0].texte, 'Résiliation programmée : Institut Aurore, fin le 4 janvier 2027.');
  });

  test('updated sans changement visible (renouvellement) : abonnement mis à jour, pas de journal', () => {
    const ev = fixture('customer.subscription.updated.cancel_at.json');
    ev.data.object.cancel_at = null;
    ev.data.object.canceled_at = null;
    ev.data.previous_attributes = { items: { data: [{ current_period_end: 1791097920 }] } };
    const s = transformer(ev);
    assert.equal(s.abonnements.length, 1);
    assert.equal(s.abonnements[0].annule_le, null);
    assert.equal(s.journal.length, 0);
  });

  test('updated : résiliation annulée, et passage en retard de paiement', () => {
    const ev = fixture('customer.subscription.updated.cancel_at.json');
    ev.data.object.cancel_at = null;
    ev.data.previous_attributes = { cancel_at: 1799046720 };
    assert.match(transformer(ev).journal[0].texte, /^Résiliation annulée : Institut Aurore continue/);
    const retard = fixture('customer.subscription.updated.cancel_at.json');
    retard.data.object.cancel_at = null;
    retard.data.object.status = 'past_due';
    retard.data.previous_attributes = { status: 'active' };
    const s = transformer(retard);
    assert.equal(s.abonnements[0].statut, 'past_due');
    assert.equal(s.journal[0].texte, 'Abonnement en retard de paiement : Institut Aurore.');
  });

  test('forme ancienne : current_period_end sur l\'abonnement et cancel_at_period_end', () => {
    const ev = fixture('customer.subscription.updated.cancel_at.json');
    const sub = ev.data.object;
    sub.current_period_end = 1793776320;
    sub.current_period_start = 1791097920;
    delete sub.items.data[0].current_period_end;
    sub.cancel_at = null;
    sub.cancel_at_period_end = true;
    ev.data.previous_attributes = { cancel_at_period_end: false };
    const s = transformer(ev);
    assert.equal(s.abonnements[0].prochaine_facture, '2026-11-04T07:12:00.000Z');
    assert.equal(s.abonnements[0].annule_le, '2026-11-04T07:12:00.000Z');
    assert.equal(s.journal[0].texte, 'Résiliation programmée : Institut Aurore, fin le 4 novembre 2026.');
  });

  test('created : pack trimestriel, engagement lu dans metadata.fin_engagement', () => {
    const ev = fixture('customer.subscription.updated.cancel_at.json');
    ev.type = 'customer.subscription.created';
    delete ev.data.previous_attributes;
    const sub = ev.data.object;
    sub.cancel_at = null;
    sub.canceled_at = null;
    sub.items.data[0].price.recurring.interval_count = 3;
    sub.items.data[0].price.unit_amount = 105000;
    sub.metadata = { fin_engagement: '2027-02-04' };
    const s = transformer(ev);
    verifierForme(s);
    assert.equal(s.abonnements[0].intervalle_mois, 3);
    assert.equal(s.abonnements[0].montant, 1050);
    assert.equal(s.abonnements[0].fin_engagement, '2027-02-04T00:00:00.000Z');
    assert.match(sansEspaces(s.journal[0].texte), /^Nouveaupack3mois:InstitutAurore,1050€tousles3mois\.$/);
  });

  test('deleted : statut canceled, plus de prochaine facture, date de fin', () => {
    const s = transformer('customer.subscription.deleted.json');
    verifierForme(s);
    const a = s.abonnements[0];
    assert.equal(a.statut, 'canceled');
    assert.equal(a.marche, 'us');
    assert.equal(a.devise, 'USD');
    assert.equal(a.montant, 497);
    assert.equal(a.prochaine_facture, null);
    assert.equal(a.annule_le, '2026-10-04T13:10:00.000Z');
    assert.equal(a.fin_engagement, '2026-12-04T11:45:00.000Z'); // metadata.engagement_mois = 3
    assert.match(sansEspaces(s.journal[0].texte), /^Abonnementterminé:GlowAesthetics\(497\$\/mois\)\.$/);
  });
});

describe('charge.refunded et charge.dispute.created', () => {
  test('remboursement partiel : montant négatif de la part remboursée', () => {
    const ev = fixture('charge.refunded.partiel.json');
    const s = transformer(ev);
    verifierForme(s);
    assert.equal(s.paiements.length, 1);
    const p = s.paiements[0];
    assert.equal(p.type, 'remboursement');
    assert.equal(p.montant, -150);
    assert.equal(p.devise, 'EUR');
    assert.equal(p.marche, 'fr');
    assert.equal(p.stripe_event_id, ev.id);
    assert.equal(p.stripe_customer_id, 'cus_TAu7r0reInst1t');
    assert.equal(p.paye_le, '2026-10-04T10:21:30.000Z');
    assert.match(p.description, /^Remboursement partiel de ch_3SKw3lJ8kR4mTzWQ0Aur0re1/);
    assert.match(sansEspaces(s.journal[0].texte), /^Remboursementpartiel:InstitutAurore,−150€\.$/);
  });

  test('2e remboursement : seule la nouvelle part compte (amount_refunded est cumulé)', () => {
    const ev = fixture('charge.refunded.partiel.json');
    ev.data.object.amount_refunded = 25000;
    ev.data.previous_attributes = { amount_refunded: 15000 };
    assert.equal(transformer(ev).paiements[0].montant, -100);
    ev.data.object.amount_refunded = 39000;
    ev.data.object.refunded = true;
    ev.data.previous_attributes = { amount_refunded: 25000, refunded: false };
    const s = transformer(ev);
    assert.equal(s.paiements[0].montant, -140);
    assert.match(s.paiements[0].description, /^Remboursement total/);
  });

  test('litige : montant contesté en négatif, client lu sur la charge', () => {
    const ev = fixture('charge.dispute.created.json');
    const s = transformer(ev);
    verifierForme(s);
    const p = s.paiements[0];
    assert.equal(p.type, 'litige');
    assert.equal(p.montant, -497);
    assert.equal(p.devise, 'USD');
    assert.equal(p.taux_eur, 0.890869);
    assert.equal(p.marche, 'us');
    assert.equal(p.stripe_customer_id, 'cus_TG1owAesthet1c');
    assert.equal(p.paye_le, '2026-10-04T13:10:00.000Z');
    assert.match(p.description, /motif : fraudulent/);
    assert.match(s.journal[0].texte, /Preuves à envoyer avant le 14 octobre 2026/);
  });

  test('litige sans client lisible : marché selon la devise', () => {
    const s = transformer('charge.dispute.created.json', { client: null });
    assert.equal(s.paiements[0].marche, 'us');
    assert.equal(s.paiements[0].stripe_customer_id, null);
    assert.match(s.journal[0].texte, /^Litige ouvert : cus_|^Litige ouvert : client inconnu/);
  });
});

describe('robustesse et outils', () => {
  test('événement non géré ou incomplet : rien à écrire', () => {
    const vide = { clients: [], paiements: [], abonnements: [], journal: [], actions: [] };
    assert.deepEqual(m.transformerEvenementStripe({ type: 'customer.created', data: { object: { id: 'cus_x' } } }), vide);
    assert.deepEqual(m.transformerEvenementStripe(null), vide);
    assert.deepEqual(m.transformerEvenementStripe({ type: 'invoice.paid' }), vide);
    assert.deepEqual(m.transformerEvenementStripe({ type: 'invoice.paid', data: {} }, null), vide);
  });

  test('chaque événement du contrat est géré et donne au moins une ligne', () => {
    const fichiers = {
      'invoice.paid': 'invoice.paid.mensuel-eur.json',
      'invoice.payment_failed': 'invoice.payment_failed.json',
      'customer.subscription.updated': 'customer.subscription.updated.cancel_at.json',
      'customer.subscription.deleted': 'customer.subscription.deleted.json',
      'charge.refunded': 'charge.refunded.partiel.json',
      'charge.dispute.created': 'charge.dispute.created.json',
    };
    for (const type of m.EVENEMENTS_GERES) {
      let ev;
      if (type === 'customer.subscription.created') {
        ev = fixture('customer.subscription.updated.cancel_at.json');
        ev.type = type;
      } else {
        ev = fixture(fichiers[type]);
      }
      const s = transformer(ev);
      verifierForme(s);
      const total = s.paiements.length + s.abonnements.length + s.journal.length + s.actions.length;
      assert.ok(total > 0, type + ' ne produit rien');
    }
  });

  test('fonction pure : même entrée, même sortie, entrée non modifiée', () => {
    const ev = fixture('invoice.paid.mensuel-eur.json');
    const copie = JSON.parse(JSON.stringify(ev));
    const client = CLIENTS.cus_TAu7r0reInst1t;
    const a = m.transformerEvenementStripe(ev, { client, tauxUsdEur: 0.9 });
    const b = m.transformerEvenementStripe(ev, { client, tauxUsdEur: 0.9 });
    assert.deepEqual(a, b);
    assert.deepEqual(ev, copie);
  });

  test('cibleClientStripe : client, charge du litige, ou rien', () => {
    assert.equal(m.cibleClientStripe(fixture('invoice.paid.usd.json')), 'https://api.stripe.com/v1/customers/cus_TG1owAesthet1c');
    assert.equal(m.cibleClientStripe(fixture('charge.dispute.created.json')),
      'https://api.stripe.com/v1/charges/ch_3SKx9oJ8kR4mTzWQ0G1owAe1?expand[]=customer');
    assert.equal(m.cibleClientStripe({ type: 'charge.refunded', data: { object: { id: 'ch_x', customer: null } } }), null);
    assert.equal(m.cibleClientStripe({}), null);
  });

  test('normaliserClient : client supprimé, erreur HTTP ou objet inattendu donnent null', () => {
    assert.equal(m.normaliserClient({ id: 'cus_x', object: 'customer', deleted: true }), null);
    assert.equal(m.normaliserClient({ error: { message: 'No such customer' } }), null);
    assert.equal(m.normaliserClient({ object: 'charge', customer: 'cus_x' }), null);
    assert.equal(m.normaliserClient(null), null);
    assert.equal(m.normaliserClient(fixture('charge-avec-client.dispute.json')).id, 'cus_TG1owAesthet1c');
  });

  test('lireTauxBce : XML de la BCE, ou null si illisible', () => {
    assert.deepEqual(TAUX_BCE, { taux: 0.890869, source: 'BCE 2026-10-02' });
    assert.equal(m.lireTauxBce('<html>maintenance</html>'), null);
    assert.equal(m.lireTauxBce(undefined), null);
    assert.equal(m.lireTauxBce("<Cube currency='USD' rate='0'/>"), null);
  });

  test('montantLisible : format français', () => {
    assert.equal(sansEspaces(m.montantLisible(1280, 'EUR')), '1280€');
    assert.equal(sansEspaces(m.montantLisible(997.5, 'USD')), '997,50$');
  });
});

describe('fiche client (table clients)', () => {
  test('invoice.paid d\'un abonnement : fiche du client avec son prix mensuel et sa date de début', () => {
    const s = transformer('invoice.paid.mensuel-eur.json');
    verifierForme(s);
    assert.deepEqual(s.clients, [{
      stripe_customer_id: 'cus_TAu7r0reInst1t', marche: 'fr', nom: 'Institut Aurore', devise: 'EUR',
      prix_mensuel: 390, debut: s.paiements[0].paye_le.slice(0, 10), fin_engagement: null,
    }]);
  });

  test('pack 3 mois : prix mensuel = montant du pack / 3', () => {
    const s = transformer('invoice.paid.pack-3-mois.json');
    verifierForme(s);
    assert.equal(s.clients.length, 1);
    const pack = s.paiements.find((p) => p.type === 'pack');
    assert.equal(s.clients[0].prix_mensuel, Math.round(pack.montant / 3 * 100) / 100);
  });

  test('USD : fiche sur le marché us, date du jour à New York', () => {
    const s = transformer('invoice.paid.usd.json');
    verifierForme(s);
    assert.equal(s.clients.length, 1);
    assert.equal(s.clients[0].marche, 'us');
    assert.equal(s.clients[0].devise, 'USD');
    assert.equal(s.clients[0].prix_mensuel, 497);
  });

  test('customer.subscription.created actif : fiche avec fin d\'engagement', () => {
    const ev = fixture('customer.subscription.updated.cancel_at.json');
    ev.type = 'customer.subscription.created';
    ev.data.previous_attributes = undefined;
    const s = transformer(ev);
    verifierForme(s);
    assert.equal(s.clients.length, 1);
    assert.equal(s.clients[0].stripe_customer_id, 'cus_TAu7r0reInst1t');
    assert.equal(s.clients[0].fin_engagement, s.abonnements[0].fin_engagement.slice(0, 10));
  });

  test('abonnement « incomplete » ou mise à jour : pas de fiche (le premier paiement la créera)', () => {
    const ev = fixture('customer.subscription.updated.cancel_at.json');
    ev.type = 'customer.subscription.created';
    ev.data.object.status = 'incomplete';
    assert.deepEqual(transformer(ev).clients, []);
    assert.deepEqual(transformer('customer.subscription.updated.cancel_at.json').clients, []);
    assert.deepEqual(transformer('customer.subscription.deleted.json').clients, []);
  });

  test('paiement ponctuel, impayé, remboursement, litige : pas de fiche client', () => {
    for (const nom of ['invoice.payment_failed.json', 'charge.refunded.partiel.json', 'charge.dispute.created.json']) {
      assert.deepEqual(transformer(nom).clients, [], nom);
    }
    const ev = fixture('invoice.paid.mensuel-eur.json');
    delete ev.data.object.parent;
    ev.data.object.subscription = null;
    for (const l of ev.data.object.lines.data) { l.parent = { type: 'invoice_item_details', invoice_item_details: { invoice_item: 'ii_x', proration: false, subscription: null } }; }
    assert.deepEqual(transformer(ev).clients, []);
  });
});
