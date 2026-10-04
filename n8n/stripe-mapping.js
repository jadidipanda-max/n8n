'use strict';
// =====================================================================
// stripe-mapping.js : un événement Stripe devient des lignes Supabase.
// Contrat : cockpit/CONTRAT-TECHNIQUE.md, sections 1.2 et 4.
//
// Fonction pure (aucun appel réseau, aucune horloge) :
//   transformerEvenementStripe(evenement, contexte)
//     -> { clients: [...], paiements: [...], abonnements: [...], journal: [...], actions: [...] }
//   clients : la fiche du client abonné (créée par n8n si elle n'existe pas encore,
//             jamais écrasée : on_conflict=stripe_customer_id + ignore-duplicates)
//   contexte = { client, tauxUsdEur, sourceTaux }
//     client      : le client Stripe lu par n8n (ou une charge avec le client
//                   déplié, pour un litige), sinon null
//     tauxUsdEur  : euros pour 1 dollar (BCE du jour, ou réglage de secours)
//
// Ce fichier est collé tel quel dans le nœud Code de n8n par build.js.
// Il gère les deux formes connues des factures Stripe :
//   - ancienne (API jusqu'à 2025-02-24.acacia) : invoice.subscription,
//     lines.data[].price.recurring, lines.data[].type ;
//   - récente (2025-03-31.basil et après) : invoice.parent.subscription_details,
//     lines.data[].parent, lines.data[].pricing, lines.data[].period.
// =====================================================================

// Taux utilisé seulement si n8n n'a ni le taux BCE ni le réglage « change »
const TAUX_USD_EUR_DERNIER_RECOURS = 0.891;
// Engagement par défaut quand l'abonnement Stripe ne précise rien (cahier des charges : 3 mois)
const ENGAGEMENT_MOIS_DEFAUT = 3;
// Types de paiement acceptés par la table paiements
const TYPES_PAIEMENT = ['abonnement', 'mise_en_place', 'pack', 'ponctuel', 'remboursement', 'litige'];
// Une ligne ponctuelle dont la description dit « mise en place » devient mise_en_place
const MOTIF_MISE_EN_PLACE = /mise en place|mise-en-place|installation|setup|onboarding|frais de lancement/i;
// Agent qui signe les lignes de journal et les actions liées à l'argent
const AGENT_ARGENT = 'finance';

const EVENEMENTS_GERES = [
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  'charge.dispute.created',
];

// ---------------------------------------------------------------------
// Petits outils
// ---------------------------------------------------------------------
function vide() {
  return { clients: [], paiements: [], abonnements: [], journal: [], actions: [] };
}

function enUnites(centimes) {
  return Math.round(Number(centimes || 0)) / 100;
}

function arrondi(n, decimales) {
  const f = Math.pow(10, decimales);
  return Math.round(n * f) / f;
}

function dateIso(secondes) {
  if (secondes === null || secondes === undefined || secondes === '') return null;
  const n = Number(secondes);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function idDe(valeur) {
  if (!valeur) return null;
  if (typeof valeur === 'string') return valeur;
  if (typeof valeur === 'object' && typeof valeur.id === 'string') return valeur.id;
  return null;
}

function texte(valeur, max) {
  const t = String(valeur === null || valeur === undefined ? '' : valeur).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function deviseStripe(code) {
  return String(code || '').toUpperCase();
}

// 1280 -> « 1 280 € » ; 997.5 -> « 997,50 $ »
function montantLisible(montant, devise) {
  const entier = Math.abs(montant % 1) < 0.005;
  const nombre = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: entier ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(montant);
  const symbole = devise === 'EUR' ? '€' : devise === 'USD' ? '$' : devise;
  return nombre + ' ' + symbole;
}

function fuseauMarche(marche) {
  return marche === 'us' ? 'America/New_York' : 'Europe/Paris';
}

// 1767484800 -> « 4 janvier 2027 » à l'heure du marché
function dateLisible(secondes, marche) {
  if (!secondes) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: fuseauMarche(marche),
  }).format(new Date(Number(secondes) * 1000));
}

// Date du jour (AAAA-MM-JJ) à l'heure du marché, pour une date Stripe (secondes)
function jourMarche(secondes, marche) {
  if (!secondes) return null;
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: fuseauMarche(marche),
  }).format(new Date(Number(secondes) * 1000));
}

// Ajoute n mois à une date Stripe (secondes), en gardant le jour si possible
function ajouterMois(secondes, n) {
  const d = new Date(Number(secondes) * 1000);
  const jour = d.getUTCDate();
  const cible = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1,
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(jour, dernierJour));
  return cible.toISOString();
}

// ---------------------------------------------------------------------
// Client Stripe, marché et taux de change
// ---------------------------------------------------------------------

// Ce que n8n doit lire chez Stripe pour connaître le client (null : rien à lire)
function cibleClientStripe(evenement) {
  const objet = (evenement && evenement.data && evenement.data.object) || {};
  if (evenement && evenement.type === 'charge.dispute.created') {
    const charge = idDe(objet.charge);
    return charge ? 'https://api.stripe.com/v1/charges/' + encodeURIComponent(charge) + '?expand[]=customer' : null;
  }
  const client = idDe(objet.customer);
  return client ? 'https://api.stripe.com/v1/customers/' + encodeURIComponent(client) : null;
}

// Réponse de Stripe (client, ou charge avec client déplié) -> client Stripe ou null
function normaliserClient(reponse) {
  if (!reponse || typeof reponse !== 'object' || reponse.error) return null;
  if (reponse.object === 'customer') return reponse.deleted ? null : reponse;
  if (reponse.object === 'charge' && reponse.customer && typeof reponse.customer === 'object') {
    return normaliserClient(reponse.customer);
  }
  return null;
}

function marcheDuClient(client) {
  const brut = client && client.metadata && client.metadata.marche;
  const m = String(brut || '').trim().toLowerCase();
  return m === 'fr' || m === 'us' ? m : null;
}

// metadata.marche du client Stripe, sinon la devise (USD donne us)
function choisirMarche(client, devise) {
  return marcheDuClient(client) || (devise === 'USD' ? 'us' : 'fr');
}

function nomClient(client, objet) {
  return texte(
    (client && (client.name || client.email)) ||
    (objet && (objet.customer_name || objet.customer_email)) ||
    idDe(objet && objet.customer) ||
    'client inconnu', 80);
}

// Taux BCE du jour : le XML donne des dollars pour 1 euro, on veut des euros pour 1 dollar
function lireTauxBce(xml) {
  if (typeof xml !== 'string') return null;
  const m = xml.match(/currency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/);
  if (!m) return null;
  const dollarsPourUnEuro = Number(m[1]);
  if (!Number.isFinite(dollarsPourUnEuro) || dollarsPourUnEuro <= 0) return null;
  const jour = (xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/) || [])[1] || null;
  return { taux: arrondi(1 / dollarsPourUnEuro, 6), source: 'BCE ' + (jour || 'du jour') };
}

// Réglage « change » lu dans Supabase : [{ valeur: { usd_eur, source } }] ou { valeur: … }
function lireTauxSecours(reponse) {
  const ligne = Array.isArray(reponse) ? reponse[0] : reponse;
  const valeur = ligne && (ligne.valeur || ligne);
  const taux = valeur ? Number(valeur.usd_eur) : NaN;
  if (!Number.isFinite(taux) || taux <= 0) return null;
  return { taux: taux, source: 'réglage ' + (valeur.source || 'change') };
}

function tauxPour(devise, contexte) {
  if (devise === 'EUR') return 1;
  const t = Number(contexte && contexte.tauxUsdEur);
  return Number.isFinite(t) && t > 0 ? arrondi(t, 6) : TAUX_USD_EUR_DERNIER_RECOURS;
}

// ---------------------------------------------------------------------
// Factures : lecture des deux formes connues
// ---------------------------------------------------------------------
function abonnementDeFacture(facture) {
  const parent = facture.parent;
  if (parent && parent.subscription_details) return idDe(parent.subscription_details.subscription);
  if (facture.subscription) return idDe(facture.subscription);
  const lignes = (facture.lines && facture.lines.data) || [];
  for (const l of lignes) {
    const p = l.parent || {};
    const s = (p.subscription_item_details && p.subscription_item_details.subscription) ||
      (p.invoice_item_details && p.invoice_item_details.subscription) || l.subscription;
    if (s) return idDe(s);
  }
  return null;
}

// Durée de récurrence d'un prix Stripe, en mois
function moisDeRecurrence(recurrence) {
  if (!recurrence || !recurrence.interval) return null;
  const n = Number(recurrence.interval_count) || 1;
  switch (recurrence.interval) {
    case 'month': return n;
    case 'year': return 12 * n;
    case 'week': return Math.max(1, Math.round((7 * n) / 30.44));
    case 'day': return Math.max(1, Math.round(n / 30.44));
    default: return null;
  }
}

// Durée d'une période de facturation (secondes Stripe), en mois
function moisDePeriode(periode) {
  if (!periode || !periode.start || !periode.end || periode.end <= periode.start) return null;
  return Math.max(1, Math.round((periode.end - periode.start) / 86400 / 30.44));
}

function prixDeLigne(ligne) {
  if (ligne.price && typeof ligne.price === 'object') return ligne.price;
  const details = ligne.pricing && ligne.pricing.price_details;
  if (details && details.price && typeof details.price === 'object') return details.price;
  return null;
}

// Une ligne de facture est-elle la partie récurrente d'un abonnement ?
function ligneRecurrente(ligne) {
  if (ligne.parent && ligne.parent.type) return ligne.parent.type === 'subscription_item_details';
  if (ligne.type) return ligne.type === 'subscription';
  const prix = prixDeLigne(ligne);
  return Boolean((prix && prix.recurring) || ligne.plan);
}

function ligneProrata(ligne) {
  const p = ligne.parent || {};
  const d = p.subscription_item_details || p.invoice_item_details;
  return Boolean((d && d.proration) || ligne.proration);
}

function moisDeLigne(ligne) {
  const prix = prixDeLigne(ligne);
  return moisDeRecurrence(prix && prix.recurring) ||
    moisDeRecurrence(ligne.plan) ||
    (ligneProrata(ligne) ? null : moisDePeriode(ligne.period));
}

// Type forcé à la main dans Stripe : metadata.type_paiement sur la ligne ou le prix
function typeForce(ligne) {
  const prix = prixDeLigne(ligne);
  const brut = (ligne.metadata && ligne.metadata.type_paiement) || (prix && prix.metadata && prix.metadata.type_paiement);
  const t = String(brut || '').trim().toLowerCase();
  return TYPES_PAIEMENT.indexOf(t) >= 0 && t !== 'remboursement' && t !== 'litige' ? t : null;
}

// Montant réellement facturé pour une ligne (après remises), en centimes
function montantNetLigne(ligne) {
  let total = Number(ligne.amount || 0);
  const credits = Array.isArray(ligne.pretax_credit_amounts) ? ligne.pretax_credit_amounts
    : Array.isArray(ligne.discount_amounts) ? ligne.discount_amounts : [];
  for (const c of credits) total -= Number(c.amount || 0);
  return total;
}

function rowPaiement(champs) {
  // Exactement les colonnes du contrat écrites par n8n (client_id est relié par la base)
  return {
    stripe_event_id: champs.stripe_event_id,
    stripe_invoice_id: champs.stripe_invoice_id || null,
    stripe_customer_id: champs.stripe_customer_id || null,
    marche: champs.marche,
    type: champs.type,
    montant: champs.montant,
    devise: champs.devise,
    taux_eur: champs.taux_eur,
    paye_le: champs.paye_le,
    description: champs.description ? texte(champs.description, 300) : null,
  };
}

// Fiche client (table clients) d'un client Stripe abonné. Toujours les mêmes colonnes.
// La base relie ensuite paiements et abonnements à cette fiche (stripe_customer_id).
function rowClient(champs) {
  return {
    stripe_customer_id: champs.stripe_customer_id,
    marche: champs.marche,
    nom: champs.nom,
    devise: champs.devise,
    prix_mensuel: champs.prix_mensuel === undefined ? null : champs.prix_mensuel,
    debut: champs.debut || null,
    fin_engagement: champs.fin_engagement || null,
  };
}

function suffixeTest(objet) {
  return objet && objet.livemode === false ? ' (test)' : '';
}

// ---------------------------------------------------------------------
// invoice.paid : 1 à n paiements (abonnement ou pack, mise en place, ponctuel)
// ---------------------------------------------------------------------
function facturePayee(evenement, facture, contexte) {
  const sortie = vide();
  const client = normaliserClient(contexte.client);
  const devise = deviseStripe(facture.currency);
  const marche = choisirMarche(client, devise);
  const nom = nomClient(client, facture);
  const ref = facture.number || facture.id;

  if (devise !== 'EUR' && devise !== 'USD') {
    sortie.journal.push({ marche: marche, agent: AGENT_ARGENT,
      texte: texte('Paiement en ' + devise + ' ignoré (' + nom + ', facture ' + ref + ') : seuls EUR et USD comptent dans le cash.', 500) });
    return sortie;
  }

  const paye = Number(facture.amount_paid || 0);
  if (paye <= 0) {
    sortie.journal.push({ marche: marche, agent: AGENT_ARGENT,
      texte: texte('Facture ' + ref + ' de ' + nom + ' à 0 (essai ou remise totale) : rien à ajouter au cash.', 500) });
    return sortie;
  }

  const abonnement = abonnementDeFacture(facture);
  const lignes = (facture.lines && facture.lines.data) || [];
  // Durée de l'abonnement : la plus longue des lignes récurrentes hors prorata
  let intervalle = 1;
  for (const l of lignes) {
    if (ligneRecurrente(l) && !ligneProrata(l)) intervalle = Math.max(intervalle, moisDeLigne(l) || 1);
  }
  const typeRecurrent = intervalle > 1 ? 'pack' : 'abonnement';

  // Regroupe les lignes par type de paiement
  const groupes = {};
  const ordre = [];
  for (const l of lignes) {
    let type = typeForce(l);
    if (!type) {
      if (ligneRecurrente(l)) type = typeRecurrent;
      else if (MOTIF_MISE_EN_PLACE.test(String(l.description || ''))) type = 'mise_en_place';
      else if (abonnement && facture.billing_reason === 'subscription_create') type = 'mise_en_place';
      else type = 'ponctuel';
    }
    if (!groupes[type]) { groupes[type] = { centimes: 0, descriptions: [] }; ordre.push(type); }
    groupes[type].centimes += montantNetLigne(l);
    if (l.description) groupes[type].descriptions.push(String(l.description));
  }
  if (!ordre.length) {
    const type = abonnement ? typeRecurrent : 'ponctuel';
    groupes[type] = { centimes: paye, descriptions: [facture.description || ''] };
    ordre.push(type);
  }

  // Ligne principale : la partie récurrente, sinon la plus grosse
  ordre.sort(function (a, b) {
    const ra = a === 'abonnement' || a === 'pack' ? 1 : 0;
    const rb = b === 'abonnement' || b === 'pack' ? 1 : 0;
    return rb - ra || groupes[b].centimes - groupes[a].centimes;
  });
  // Le total suit toujours ce que Stripe a encaissé (taxes, solde client, lignes non listées)
  const somme = ordre.reduce(function (s, t) { return s + groupes[t].centimes; }, 0);
  groupes[ordre[0]].centimes += paye - somme;
  // Cas rare (gros avoir client) : une seule ligne avec tout l'encaissé
  if (ordre.some(function (t) { return groupes[t].centimes < 0; })) {
    const principal = ordre[0];
    groupes[principal] = { centimes: paye, descriptions: groupes[principal].descriptions };
    ordre.length = 1;
  }

  const taux = tauxPour(devise, contexte);
  const payeLe = dateIso(facture.status_transitions && facture.status_transitions.paid_at) || dateIso(evenement.created);
  const morceaux = [];
  ordre.forEach(function (type, i) {
    const g = groupes[type];
    if (g.centimes === 0) return;
    const montant = enUnites(g.centimes);
    sortie.paiements.push(rowPaiement({
      stripe_event_id: i === 0 ? evenement.id : evenement.id + ':' + type,
      stripe_invoice_id: facture.id,
      stripe_customer_id: idDe(facture.customer),
      marche: marche,
      type: type,
      montant: montant,
      devise: devise,
      taux_eur: taux,
      paye_le: payeLe,
      description: 'Facture ' + ref + ' · ' + (g.descriptions.join(' + ') || type.replace(/_/g, ' ')) + suffixeTest(facture),
    }));
    morceaux.push(montantLisible(montant, devise) + (type === 'abonnement' ? '' : ' ' + type.replace(/_/g, ' ')));
  });

  // Facture d'abonnement : la fiche client est créée si elle n'existe pas encore
  const idClient = idDe(facture.customer);
  if (abonnement && idClient && sortie.paiements.length) {
    const recurrent = groupes[typeRecurrent];
    sortie.clients.push(rowClient({
      stripe_customer_id: idClient,
      marche: marche,
      nom: nom,
      devise: devise,
      prix_mensuel: recurrent && recurrent.centimes > 0 ? arrondi(enUnites(recurrent.centimes) / intervalle, 2) : null,
      debut: jourMarche((facture.status_transitions && facture.status_transitions.paid_at) || evenement.created, marche),
    }));
  }

  const total = enUnites(paye);
  sortie.journal.push({ marche: marche, agent: AGENT_ARGENT,
    texte: texte('Paiement reçu : ' + nom + ', ' + montantLisible(total, devise) +
      (morceaux.length > 1 ? ' (' + morceaux.join(' + ') + ')' : sortie.paiements[0] && sortie.paiements[0].type === 'pack' ? ' (pack ' + intervalle + ' mois)' : '') +
      '.' + suffixeTest(facture), 500) });
  return sortie;
}

// ---------------------------------------------------------------------
// invoice.payment_failed : une action « relance_impaye » à valider, rien d'autre
// (la base écrit elle-même la ligne de journal « À valider : … »)
// ---------------------------------------------------------------------
function factureImpayee(evenement, facture, contexte) {
  const sortie = vide();
  const client = normaliserClient(contexte.client);
  const devise = deviseStripe(facture.currency);
  const marche = choisirMarche(client, devise);
  const nom = nomClient(client, facture);
  const montant = enUnites(facture.amount_remaining || facture.amount_due || 0);
  const tentative = Number(facture.attempt_count || 0);
  sortie.actions.push({
    marche: marche,
    agent: AGENT_ARGENT,
    type_action: 'relance_impaye',
    titre: texte('Relancer ' + nom + ' : facture ' + (facture.number || facture.id) + ' impayée (' +
      montantLisible(montant, devise) + ')' + (tentative > 1 ? ', ' + tentative + 'ᵉ échec' : '') + suffixeTest(facture), 200),
    details: {
      verrou: true,
      stripe_event_id: evenement.id,
      stripe_invoice_id: facture.id,
      stripe_customer_id: idDe(facture.customer),
      stripe_subscription_id: abonnementDeFacture(facture),
      client: nom,
      email: (client && client.email) || facture.customer_email || null,
      montant: montant,
      devise: devise,
      tentative: tentative || null,
      prochaine_tentative: dateIso(facture.next_payment_attempt),
      lien_facture: facture.hosted_invoice_url || null,
    },
  });
  return sortie;
}

// ---------------------------------------------------------------------
// customer.subscription.* : une ligne abonnements (upsert sur stripe_subscription_id)
// ---------------------------------------------------------------------
function finDePeriode(abonnement) {
  if (abonnement.current_period_end) return abonnement.current_period_end;
  const items = (abonnement.items && abonnement.items.data) || [];
  let fin = null;
  for (const it of items) {
    if (it.current_period_end && (fin === null || it.current_period_end < fin)) fin = it.current_period_end;
  }
  return fin;
}

function finEngagement(abonnement) {
  const meta = abonnement.metadata || {};
  if (meta.fin_engagement && /^\d{4}-\d{2}-\d{2}/.test(String(meta.fin_engagement))) {
    const d = new Date(String(meta.fin_engagement));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (!abonnement.start_date) return null;
  const mois = parseInt(meta.engagement_mois, 10);
  return ajouterMois(abonnement.start_date, Number.isFinite(mois) && mois >= 0 ? mois : ENGAGEMENT_MOIS_DEFAUT);
}

function ligneAbonnement(abonnement, marche) {
  const items = (abonnement.items && abonnement.items.data) || [];
  let centimes = 0;
  let intervalle = null;
  for (const it of items) {
    const prix = it.price || it.plan || {};
    const unitaire = prix.unit_amount !== undefined && prix.unit_amount !== null ? Number(prix.unit_amount)
      : prix.amount !== undefined && prix.amount !== null ? Number(prix.amount)
        : Number(prix.unit_amount_decimal || 0);
    centimes += unitaire * (it.quantity === undefined || it.quantity === null ? 1 : Number(it.quantity));
    intervalle = intervalle || moisDeRecurrence(prix.recurring) || moisDeRecurrence(it.plan);
  }
  const statut = String(abonnement.status || 'incomplete');
  const termine = statut === 'canceled' || statut === 'incomplete_expired';
  const finPeriode = finDePeriode(abonnement);
  let annuleLe = null;
  if (termine) annuleLe = dateIso(abonnement.ended_at) || dateIso(abonnement.canceled_at);
  else if (abonnement.cancel_at) annuleLe = dateIso(abonnement.cancel_at);
  else if (abonnement.cancel_at_period_end) annuleLe = dateIso(finPeriode);
  // Exactement les colonnes du contrat écrites par n8n (client_id est relié par la base)
  return {
    stripe_subscription_id: abonnement.id,
    stripe_customer_id: idDe(abonnement.customer),
    marche: marche,
    statut: statut,
    montant: enUnites(Math.round(centimes)),
    devise: deviseStripe(abonnement.currency),
    intervalle_mois: intervalle || 1,
    debut: dateIso(abonnement.start_date),
    fin_engagement: finEngagement(abonnement),
    prochaine_facture: termine ? null : dateIso(finPeriode),
    annule_le: annuleLe,
  };
}

function rythme(ligne) {
  return ligne.intervalle_mois > 1 ? ' tous les ' + ligne.intervalle_mois + ' mois' : '/mois';
}

function evenementAbonnement(evenement, abonnement, contexte) {
  const sortie = vide();
  const client = normaliserClient(contexte.client);
  const devise = deviseStripe(abonnement.currency);
  const marche = choisirMarche(client, devise);
  const nom = nomClient(client, abonnement);
  const ligne = ligneAbonnement(abonnement, marche);
  sortie.abonnements.push(ligne);

  // Nouvel abonnement actif (ou en essai) : la fiche client est créée si elle n'existe pas encore.
  // Un abonnement « incomplete » attend son premier paiement (invoice.paid créera la fiche).
  if (evenement.type === 'customer.subscription.created' && ligne.stripe_customer_id &&
      (ligne.statut === 'active' || ligne.statut === 'trialing') &&
      (ligne.devise === 'EUR' || ligne.devise === 'USD')) {
    sortie.clients.push(rowClient({
      stripe_customer_id: ligne.stripe_customer_id,
      marche: marche,
      nom: nom,
      devise: ligne.devise,
      prix_mensuel: ligne.montant > 0 ? arrondi(ligne.montant / ligne.intervalle_mois, 2) : null,
      debut: jourMarche(abonnement.start_date, marche),
      fin_engagement: ligne.fin_engagement ? jourMarche(Date.parse(ligne.fin_engagement) / 1000, marche) : null,
    }));
  }

  const prix = montantLisible(ligne.montant, ligne.devise) + rythme(ligne);
  const test = suffixeTest(abonnement);
  const avant = (evenement.data && evenement.data.previous_attributes) || {};
  let phrase = null;
  if (evenement.type === 'customer.subscription.created') {
    phrase = (ligne.intervalle_mois > 1 ? 'Nouveau pack ' + ligne.intervalle_mois + ' mois : ' : 'Nouvel abonnement : ') + nom + ', ' + prix + '.';
  } else if (evenement.type === 'customer.subscription.deleted') {
    phrase = 'Abonnement terminé : ' + nom + ' (' + prix + ').';
  } else {
    if ('cancel_at' in avant || 'cancel_at_period_end' in avant) {
      if (ligne.annule_le && ligne.statut !== 'canceled') {
        const fin = abonnement.cancel_at || (abonnement.cancel_at_period_end ? finDePeriode(abonnement) : null);
        phrase = 'Résiliation programmée : ' + nom + ', fin le ' + dateLisible(fin, marche) + '.';
      } else if (!ligne.annule_le) {
        phrase = 'Résiliation annulée : ' + nom + ' continue (' + prix + ').';
      }
    }
    if (!phrase && 'status' in avant && avant.status !== ligne.statut) {
      if (ligne.statut === 'active') phrase = 'Abonnement actif : ' + nom + ', ' + prix + '.';
      else if (ligne.statut === 'past_due') phrase = 'Abonnement en retard de paiement : ' + nom + '.';
      else if (ligne.statut === 'canceled') phrase = 'Abonnement arrêté : ' + nom + '.';
      else phrase = 'Abonnement ' + nom + ' : statut « ' + ligne.statut + ' ».';
    }
  }
  if (phrase) sortie.journal.push({ marche: marche, agent: AGENT_ARGENT, texte: texte(phrase + test, 500) });
  return sortie;
}

// ---------------------------------------------------------------------
// charge.refunded : un paiement négatif pour la part remboursée par cet événement
// ---------------------------------------------------------------------
function chargeRemboursee(evenement, charge, contexte) {
  const sortie = vide();
  const client = normaliserClient(contexte.client);
  const devise = deviseStripe(charge.currency);
  const marche = choisirMarche(client, devise);
  const nom = nomClient(client, charge);
  const avant = (evenement.data && evenement.data.previous_attributes) || {};
  // amount_refunded est cumulé : on ne garde que ce que cet événement ajoute
  const dejaRembourse = avant.amount_refunded !== undefined ? Number(avant.amount_refunded || 0) : 0;
  const centimes = Number(charge.amount_refunded || 0) - dejaRembourse;
  if (centimes <= 0) return sortie;
  if (devise !== 'EUR' && devise !== 'USD') {
    sortie.journal.push({ marche: marche, agent: AGENT_ARGENT,
      texte: texte('Remboursement en ' + devise + ' ignoré (' + nom + ') : seuls EUR et USD comptent dans le cash.', 500) });
    return sortie;
  }
  const montant = enUnites(centimes);
  const total = Number(charge.amount_refunded || 0) >= Number(charge.amount || 0);
  sortie.paiements.push(rowPaiement({
    stripe_event_id: evenement.id,
    stripe_invoice_id: idDe(charge.invoice),
    stripe_customer_id: idDe(charge.customer) || (client && client.id) || null,
    marche: marche,
    type: 'remboursement',
    montant: -montant,
    devise: devise,
    taux_eur: tauxPour(devise, contexte),
    paye_le: dateIso(evenement.created) || dateIso(charge.created),
    description: (total ? 'Remboursement total' : 'Remboursement partiel') + ' de ' + charge.id +
      (charge.description ? ' · ' + charge.description : '') + suffixeTest(charge),
  }));
  sortie.journal.push({ marche: marche, agent: AGENT_ARGENT,
    texte: texte('Remboursement' + (total ? '' : ' partiel') + ' : ' + nom + ', −' + montantLisible(montant, devise) + '.' + suffixeTest(charge), 500) });
  return sortie;
}

// ---------------------------------------------------------------------
// charge.dispute.created : un paiement négatif (Stripe retient le montant contesté)
// ---------------------------------------------------------------------
function litigeOuvert(evenement, litige, contexte) {
  const sortie = vide();
  const client = normaliserClient(contexte.client);
  const devise = deviseStripe(litige.currency);
  const marche = choisirMarche(client, devise);
  const nom = nomClient(client, litige);
  const centimes = Number(litige.amount || 0);
  if (centimes <= 0) return sortie;
  if (devise !== 'EUR' && devise !== 'USD') {
    sortie.journal.push({ marche: marche, agent: AGENT_ARGENT,
      texte: texte('Litige en ' + devise + ' ignoré (' + nom + ') : seuls EUR et USD comptent dans le cash.', 500) });
    return sortie;
  }
  const montant = enUnites(centimes);
  const echeance = litige.evidence_details && litige.evidence_details.due_by;
  sortie.paiements.push(rowPaiement({
    stripe_event_id: evenement.id,
    stripe_invoice_id: null,
    stripe_customer_id: (client && client.id) || null,
    marche: marche,
    type: 'litige',
    montant: -montant,
    devise: devise,
    taux_eur: tauxPour(devise, contexte),
    paye_le: dateIso(litige.created) || dateIso(evenement.created),
    description: 'Litige ' + litige.id + ' sur ' + idDe(litige.charge) + (litige.reason ? ' · motif : ' + litige.reason : '') + suffixeTest(litige),
  }));
  sortie.journal.push({ marche: marche, agent: AGENT_ARGENT,
    texte: texte('Litige ouvert : ' + nom + ', −' + montantLisible(montant, devise) + ' retenus par Stripe' +
      (echeance ? '. Preuves à envoyer avant le ' + dateLisible(echeance, marche) : '') + '.' + suffixeTest(litige), 500) });
  return sortie;
}

// ---------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------
function transformerEvenementStripe(evenement, contexte) {
  const ctx = contexte || {};
  if (!evenement || typeof evenement !== 'object' || !evenement.data || !evenement.data.object) return vide();
  const objet = evenement.data.object;
  switch (evenement.type) {
    case 'invoice.paid': return facturePayee(evenement, objet, ctx);
    case 'invoice.payment_failed': return factureImpayee(evenement, objet, ctx);
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': return evenementAbonnement(evenement, objet, ctx);
    case 'charge.refunded': return chargeRemboursee(evenement, objet, ctx);
    case 'charge.dispute.created': return litigeOuvert(evenement, objet, ctx);
    default: return vide();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    transformerEvenementStripe,
    cibleClientStripe,
    normaliserClient,
    choisirMarche,
    lireTauxBce,
    lireTauxSecours,
    montantLisible,
    EVENEMENTS_GERES,
    TYPES_PAIEMENT,
    TAUX_USD_EUR_DERNIER_RECOURS,
    ENGAGEMENT_MOIS_DEFAUT,
  };
}
