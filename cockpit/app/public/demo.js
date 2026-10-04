/* Données d'exemple du mode démo (celles de la maquette, état au 3 octobre 2026).
   Même forme que les lignes lues dans Supabase : vues de cash et tables du contrat.
   Jamais utilisées quand le cockpit est branché sur Supabase. */
window.COCKPIT_DEMO = (() => {
  'use strict';
  const FX = 0.891; // € pour 1 $ (hypothèse de la maquette)
  const NOW = '2026-10-03T14:05:00+02:00';
  const JAY = 'demo-jay';
  const JUNIOR = 'demo-junior';
  const r2 = v => Math.round(v * 100) / 100;

  /* ---------- vues de cash ---------- */
  const fr = { cash: 2740, cumul: 3690, mrr: 1650, objectif: 7680, signes: 2 };
  const us = { cash: 997, cumul: 997, mrr: 497, objectif: 5960, signes: 1 };
  const v_cash_resume = [
    { marche: 'fr', devise: 'EUR', cash_mois: fr.cash, cash_mois_eur: fr.cash, cumul: fr.cumul, cumul_eur: fr.cumul,
      premier_paiement: '2026-09-08', mrr: fr.mrr, mrr_eur: fr.mrr, objectif_cash: fr.objectif, objectif_clients: 6, clients_signes_mois: fr.signes },
    { marche: 'us', devise: 'USD', cash_mois: us.cash, cash_mois_eur: r2(us.cash * FX), cumul: us.cumul, cumul_eur: r2(us.cumul * FX),
      premier_paiement: '2026-10-01', mrr: us.mrr, mrr_eur: r2(us.mrr * FX), objectif_cash: us.objectif, objectif_clients: 6, clients_signes_mois: us.signes },
  ];
  v_cash_resume.push({
    marche: 'total', devise: 'EUR',
    cash_mois: r2(fr.cash + us.cash * FX), cash_mois_eur: r2(fr.cash + us.cash * FX),
    cumul: r2(fr.cumul + us.cumul * FX), cumul_eur: r2(fr.cumul + us.cumul * FX), premier_paiement: '2026-09-08',
    mrr: r2(fr.mrr + us.mrr * FX), mrr_eur: r2(fr.mrr + us.mrr * FX),
    objectif_cash: r2(fr.objectif + us.objectif * FX), objectif_clients: 12, clients_signes_mois: fr.signes + us.signes,
  });

  const mois3 = ['2026-11-01', '2026-12-01', '2027-01-01'];
  const att = { fr: [[1070, 0], [1070, 0], [690, 1560]], us: [[497, 0], [497, 0], [0, 497]] };
  const v_cash_attendu = [];
  mois3.forEach((mois, i) => {
    const [ef, pf] = att.fr[i], [eu, pu] = att.us[i];
    v_cash_attendu.push(
      { marche: 'fr', mois, devise: 'EUR', engage: ef, probable: pf, engage_eur: ef, probable_eur: pf },
      { marche: 'us', mois, devise: 'USD', engage: eu, probable: pu, engage_eur: r2(eu * FX), probable_eur: r2(pu * FX) },
      { marche: 'total', mois, devise: 'EUR', engage: r2(ef + eu * FX), probable: r2(pf + pu * FX), engage_eur: r2(ef + eu * FX), probable_eur: r2(pf + pu * FX) });
  });

  // courbe en escalier : cumul par jour avec paiement
  const pas = { fr: [['2026-09-08', 570], ['2026-09-15', 760], ['2026-09-24', 950], ['2026-10-01', 2410], ['2026-10-02', 3690]], us: [['2026-10-01', 997]] };
  const v_cash_cumul = [];
  const parJour = {};
  for (const m of ['fr', 'us']) {
    let avant = 0;
    for (const [jour, cumul] of pas[m]) {
      const eur = m === 'us' ? r2(cumul * FX) : cumul;
      v_cash_cumul.push({ marche: m, jour, cumul, cumul_eur: eur });
      parJour[jour] = (parJour[jour] || 0) + (eur - avant);
      avant = eur;
    }
  }
  let total = 0;
  Object.keys(parJour).sort().forEach(jour => { total = r2(total + parJour[jour]); v_cash_cumul.push({ marche: 'total', jour, cumul: total, cumul_eur: total }); });

  // seuils 2026 au prorata (micro créée le 19 juillet : 166 jours sur 365)
  const prorata = 166 / 365;
  const v_seuils = {
    annee: 2026, ca_france_eur: fr.cumul, ca_total_eur: r2(fr.cumul + us.cumul * FX), jours_activite: 166, jours_annee: 365,
    tva_base: r2(37500 * prorata), tva_majore: r2(41250 * prorata), plafond_micro: r2(83600 * prorata),
    alerte_tva: 'ok', alerte_micro: 'ok',
  };

  // partage 50/50 sur le résultat (cash − cotisations 25,6 % − coûts)
  const partage = (periode, debut, cash, couts) => {
    const cotisations = r2(cash * 0.256), resultat = r2(cash - cotisations - couts);
    return { periode, debut, fin: '2026-10-31', cash_eur: r2(cash), cotisations_eur: cotisations, couts_eur: couts,
      resultat_eur: resultat, part_jay_eur: r2(resultat / 2), part_junior_eur: r2(resultat / 2) };
  };
  const v_partage = [
    partage('mois', '2026-10-01', fr.cash + us.cash * FX, 65),
    partage('annee', '2026-01-01', fr.cumul + us.cumul * FX, 75),
  ];

  /* ---------- tables ---------- */
  const clients = [
    ['c1', 'fr', 'Institut Aurore', 'Esthétique', 'Pilote', 190, 'EUR', 0, '2026-09-08', '2026-12-08', 'demandes qualifiées', 30, 21, '2026-10-08T10:00:00+02:00'],
    ['c2', 'fr', 'Cuisines Delmas', 'Cuisiniste', 'Pilote', 190, 'EUR', 0, '2026-09-15', '2026-12-15', 'RDV en showroom', 12, 4, '2026-10-15T14:00:00+02:00'],
    ['c3', 'fr', 'Rivage Immobilier', 'Immobilier', 'Pilote', 190, 'EUR', 0, '2026-09-24', '2026-12-24', 'RDV d’estimation', 10, 2, '2026-10-23T11:00:00+02:00'],
    ['c4', 'fr', 'Maison Solène', 'Esthétique', 'Essentiel', 390, 'EUR', 290, '2026-10-01', '2027-01-01', 'demandes qualifiées', 25, 0, '2026-11-02T10:00:00+01:00'],
    ['c5', 'fr', 'Atelier Bois & Plan', 'Cuisiniste', 'Croissance', 690, 'EUR', 590, '2026-10-02', '2027-04-02', 'RDV en showroom', 15, 0, '2026-11-03T15:00:00+01:00'],
    ['c6', 'us', 'Glow Aesthetics', 'Med spa · Tampa, FL', 'Starter', 497, 'USD', 500, '2026-10-01', '2027-01-01', 'consultations réservées', 24, 3, '2026-11-02T11:00:00-05:00'],
  ].map(([id, marche, nom, niche, palier, prix_mensuel, devise, mise_en_place, debut, fin_engagement, objectif_garantie, objectif_valeur, resultat_valeur, prochain_point]) => ({
    id, marche, nom, niche, palier, prix_mensuel, devise, mise_en_place, debut, fin_engagement, objectif_garantie,
    objectif_valeur, resultat_valeur, prochain_point, point_booke: true, statut: 'actif', owner_id: marche === 'fr' ? JAY : JUNIOR,
  }));

  const actions = [
    ['a1', 'fr', 'paperasse', 'envoyer_proposition', 'Spa Lumen · Essentiel 390 €/mois', '2026-10-03T13:48:00+02:00'],
    ['a2', 'fr', 'paperasse', 'relancer_offre', 'Institut Néroli · offre sans réponse depuis 3 jours', '2026-10-02T23:14:00+02:00'],
    ['a3', 'fr', 'finance', 'preparer_facture', '2026-021 · Atelier Bois & Plan · 690 €', '2026-10-02T09:20:00+02:00'],
    ['u1', 'us', 'prospection_us', 'mission_apify', 'Houston, TX · 500 med spas · environ 2 $', '2026-10-03T08:30:00-04:00'],
    ['u2', 'us', 'paperasse', 'envoyer_proposition', 'Radiance MedSpa · Starter 497 $/mois', '2026-10-03T07:50:00-04:00'],
  ].map(([id, marche, agent, type_action, titre, cree_le]) => ({ id, marche, agent, type_action, titre, details: {}, statut: 'en_attente', auto: false, cree_le }));

  const autonomie = [
    ['prospection_fr', 'preparer_messages_facebook', 2, false, 0], ['prospection_us', 'preparer_messages_facebook', 2, false, 0],
    ['prospection_fr', 'mission_apify', 0, true, 0], ['prospection_us', 'mission_apify', 0, true, 0],
    ['paperasse', 'preparer_proposition', 2, false, 0], ['paperasse', 'envoyer_proposition', 0, false, 0],
    ['paperasse', 'relancer_offre', 1, false, 3], ['paperasse', 'envoyer_contrat', 0, true, 0],
    ['finance', 'preparer_facture', 1, false, 4], ['finance', 'changer_prix', 0, true, 0],
    ['finance', 'alerte_prix_plancher', 2, false, 0], ['finance', 'relance_impaye', 0, true, 0],
    ['suivi_clients', 'booker_point_mensuel', 2, false, 0], ['suivi_clients', 'envoyer_rapport_mensuel', 1, false, 1],
    ['suivi_clients', 'booker_demo', 2, false, 0], ['suivi_clients', 'deplacer_rdv_client', 0, false, 0],
    ['researcher', 'chercher_pistes', 2, false, 0], ['researcher', 'changer_offre', 0, false, 0],
    ['reporter', 'ecrire_rapport', 2, false, 0], ['reporter', 'changer_trajectoire', 0, false, 0],
    ['reporter', 'sources_externes', 2, false, 0],
  ].map(([agent, type_action, niveau, verrou, ok_consecutifs]) => ({ agent, type_action, niveau, verrou, ok_consecutifs }));

  const messages = [
    { id: 'm1', auteur: 'hermes', auteur_id: null, marche: null, type: 'rapport', cree_le: '2026-10-02T23:00:00+02:00',
      contenu: 'Rapport du 2 octobre\n- France : 83 appels, 47 gérants joints, 2 démos prises.\n- USA : 41 appels, 1 démo prise.\n- Cash du mois : 3 628 € (France 2 740 € · USA 997 $).\n- Verdict : tenir le cap. 12 démos sur les 20 nécessaires pour juger le prix.\n3 décisions t’attendent.' },
    { id: 'm2', auteur: 'jay', auteur_id: JAY, marche: 'fr', type: 'message', cree_le: '2026-10-02T23:14:10+02:00', contenu: 'Ok. Relance Néroli demain matin.' },
    { id: 'm3', auteur: 'hermes', auteur_id: null, marche: 'fr', type: 'message', cree_le: '2026-10-02T23:14:40+02:00',
      contenu: 'Noté, relance prévue demain à 9:30. C’est ta 3ᵉ validation sans correction sur ce type de relance : à 5, je les enverrai seul.' },
    { id: 'm4', auteur: 'hermes', auteur_id: null, marche: 'fr', type: 'message', cree_le: '2026-10-03T09:12:00+02:00',
      contenu: 'Paiement reçu : Atelier Bois & Plan, 1 280 €. Ajouté au cash du mois.' },
  ];

  const rapports = [{
    jour: '2026-10-02', verdict: 'tenir', resume: 'Tenir le cap : 12 démos sur les 20 nécessaires pour juger le prix.',
    contenu: 'France : 83 appels, 47 gérants joints, 2 démos prises.\nUSA : 41 appels, 1 démo prise.\nCash du mois : 3 628 € (France 2 740 € · USA 997 $).\nVerdict : tenir le cap.',
    donnees: { appels_fr: 83, appels_us: 41, demos_total: 12, demos_necessaires: 20, signature_apres_demo: 0.25 },
    cree_le: '2026-10-02T23:00:00+02:00',
  }];

  const agents_etat = [
    ['hermes', 'Hermès', null, 'ok', 'Rapport du 2 octobre envoyé à Jay et Junior.', '2026-10-02T23:02:00+02:00', null, 0.94],
    ['prospection_fr', 'Prospection France', 'fr', 'run', '856 leads restent à appeler : pas besoin d’en chercher.', '2026-10-03T13:59:00+02:00', null, 0.21],
    ['prospection_us', 'Prospection USA', 'us', 'run', '1 812 med spas restent à appeler en Floride et au Texas.', '2026-10-03T13:56:00+02:00', null, 0.18],
    ['finance', 'Finance', null, 'run', 'Objectif d’octobre recalculé avec la grille normale.', '2026-10-03T14:02:00+02:00', null, 0.34],
    ['paperasse', 'Propositions et contrats', null, 'wait', 'Brouillon Spa Lumen prêt à relire.', '2026-10-03T13:45:00+02:00', null, 0.52],
    ['reporter', 'Rapport du soir', null, 'idle', 'Je compile les appels, le cash et 3 sources externes.', '2026-10-02T23:00:00+02:00', '2026-10-03T23:00:00+02:00', 0],
    ['researcher', 'Recherche rentabilité', null, 'run', 'Je compare les statuts possibles pour J-Square.', '2026-10-03T13:53:00+02:00', null, 0.61],
    ['suivi_clients', 'Suivi clients', null, 'ok', 'Institut Aurore : 2 demandes qualifiées de plus.', '2026-10-03T13:24:00+02:00', null, 0.12],
  ].map(([agent, nom, marche, statut, derniere_phrase, derniere_execution, prochaine_execution, cout_jour_eur]) =>
    ({ agent, nom, marche, statut, derniere_phrase, derniere_execution, prochaine_execution, cout_jour_eur }));

  const journal = [
    ['j1', 'fr', 'finance', 'Objectif d’octobre recalculé : 6 clients, 7 680 €.', '2026-10-03T14:02:00+02:00'],
    ['j2', 'fr', 'paperasse', 'Brouillon Spa Lumen prêt à relire.', '2026-10-03T13:48:00+02:00'],
    ['j3', 'us', 'prospection_us', 'Floride : 188 med spas appelés sur 1 000.', '2026-10-03T13:30:00+02:00'],
    ['j4', null, 'hermes', 'Paiement reçu : Atelier Bois & Plan, 1 280 €.', '2026-10-03T09:12:00+02:00'],
  ].map(([id, marche, agent, texte, cree_le]) => ({ id, marche, agent, texte, cree_le }));

  const objectifs = [
    { mois: '2026-10-01', marche: 'fr', clients_vises: 6, cash_vise: 7680, devise: 'EUR', calcule_par: 'finance' },
    { mois: '2026-10-01', marche: 'us', clients_vises: 6, cash_vise: 5960, devise: 'USD', calcule_par: 'finance' },
  ];

  // écrans d'appel : une ligne par lead (statut a_appeler tant qu'il n'a pas été appelé)
  const appels = [];
  const ecran = (marche, nom, total, aAppeler, aujourdhui, jour, special = []) => {
    const faits = total - aAppeler;
    const statuts = ['joint', 'pas_interesse', 'joint', 'rappel', 'pas_interesse'];
    for (let i = 0; i < total; i++) {
      const sp = special[i];
      if (sp) { appels.push({ marche, ecran: nom, lead_ref: sp[0], statut: 'demo', note: null, rappel_le: sp[1], maj: jour + 'T11:00:00+02:00' }); continue; }
      const fait = i < faits;
      appels.push({
        marche, ecran: nom, lead_ref: `${nom}-${i + 1}`, statut: fait ? statuts[i % statuts.length] : 'a_appeler', note: null, rappel_le: null,
        maj: fait ? (i < aujourdhui ? jour + 'T' + String(9 + (i % 5)).padStart(2, '0') + ':00:00+02:00' : '2026-10-02T15:00:00+02:00') : '2026-09-01T09:00:00+02:00',
      });
    }
  };
  ecran('fr', 'standard', 323, 241, 64, '2026-10-03', [
    ['Institut Néroli (esthétique, 93)', '2026-10-05T10:00:00+02:00'],
    ['Cuisines Arlequin', '2026-10-06T18:30:00+02:00'],
    ['Institut Belle Rive', '2026-10-07T11:00:00+02:00']]);
  ecran('fr', 'acquisition', 615, 615, 0, '2026-10-03');
  ecran('us', 'us_floride', 1000, 812, 37, '2026-10-03', [
    ['Radiance MedSpa (Orlando)', '2026-10-06T15:00:00-04:00'],
    ['Lone Star Aesthetics (Austin)', '2026-10-08T16:30:00-04:00']]);
  ecran('us', 'us_texas', 1000, 1000, 0, '2026-10-03');

  /* ---------- illustrations sans table dans le contrat (démo seulement) ---------- */
  const extras = {
    marche: {
      fr: { compare: { leur: 450, notre: 390, label: 'Notre Essentiel' },
        lignes: [['Frais d’agence payés aujourd’hui', 'médiane 450 €/mois', '14 réponses'], ['Budget pub', 'médiane 600 €/mois', '11 réponses'], ['Satisfaits de leur prestataire', '4 sur 14', ''], ['Engagement qui finit sous 3 mois', '5 gérants', '']] },
      us: { compare: { leur: 1500, notre: 497, label: 'Notre Starter' },
        lignes: [['Agence actuelle (retainer)', 'médiane 1 500 $/mois', '6 réponses'], ['Budget pub', 'médiane 2 000 $/mois', '5 réponses'], ['Rappellent les leads en moins de 5 min', '1 sur 9', ''], ['Règle d’appel', 'manuel uniquement (TCPA)', '']] },
    },
    pistes: [
      ['Structure', 'Tout passe par la micro de Jay', 'à voir', true],
      ['Factures', 'Plateforme agréée à choisir', 'obligatoire', true],
      ['Embauche', 'Setter quand les appels dépassent 100/jour', 'suivi', false],
      ['Offre', 'Tarif annuel avec 2 mois offerts', 'à tester', false],
    ],
  };

  // activité simulée : une ligne de journal toutes les quelques secondes
  const simulation = [
    { marche: 'fr', agent: 'prospection_fr', texte: 'Appel passé à un institut du 93 : rappel demandé mardi.', appel: 'fr' },
    { marche: null, agent: 'hermes', texte: 'Point de 14 h envoyé à Jay et Junior.' },
    { marche: 'us', agent: 'prospection_us', texte: 'Junior a joint un med spa à Orlando : démo jeudi.', appel: 'us' },
    { marche: 'fr', agent: 'suivi_clients', texte: 'Institut Aurore : 1 demande qualifiée de plus.' },
    { marche: null, agent: 'researcher', texte: 'Nouvelle piste : tarif annuel avec 2 mois offerts.' },
    { marche: 'fr', agent: 'paperasse', texte: 'Brouillon Spa Lumen mis à jour avec la garantie.' },
    { marche: 'us', agent: 'suivi_clients', texte: 'Glow Aesthetics : 1 consultation réservée.' },
    { marche: null, agent: 'finance', texte: 'Coût des agents aujourd’hui : 2,80 €.' },
  ];

  return {
    now: NOW,
    profil: { id: JAY, nom: 'Jay', role: 'admin', marche: 'fr' },
    reponse: 'Mode démo : je ne suis pas encore branché. Dans le vrai cockpit, je réponds ici avec vos données.',
    vues: { v_cash_resume, v_cash_attendu, v_cash_cumul, v_seuils, v_partage },
    tables: { clients, actions, autonomie, messages, rapports, agents_etat, journal, objectifs, appels },
    extras,
    simulation,
  };
})();
