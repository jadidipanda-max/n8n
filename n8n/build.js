'use strict';
// =====================================================================
// build.js : fabrique les workflows n8n à importer, à partir des .js testés.
//
//   node n8n/build.js              écrit n8n/workflows/*.json
//   node n8n/build.js --verifier   vérifie que les JSON sont à jour (sortie 1 sinon)
//
// Le code de stripe-mapping.js et de rapport-du-soir.js est collé tel quel
// dans les nœuds Code : les workflows et les tests restent synchronisés.
// Variables facultatives au moment du build : SUPABASE_URL, HERMES_URL,
// HERMES_MODEL, STRIPE_API_VERSION (sinon des valeurs à remplacer dans n8n).
// =====================================================================

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DOSSIER = __dirname;
const DOSSIER_WORKFLOWS = path.join(DOSSIER, 'workflows');
const FICHIERS = {
  stripe: 'stripe-vers-supabase.json',
  rapport: 'rapport-du-soir.json',
};

// Noms des identifiants à créer dans n8n (voir README)
const IDENTIFIANTS = {
  stripe: { type: 'stripeApi', nom: 'Stripe J-Square' },
  supabase: { type: 'httpHeaderAuth', nom: 'Supabase n8n (clé secrète)' },
  hermes: { type: 'httpBearerAuth', nom: 'Hermès API' },
};

const REGLAGES_PAR_DEFAUT = {
  supabaseUrl: 'https://VOTRE-PROJET.supabase.co',
  hermesUrl: 'http://host.docker.internal:8642',
  hermesModel: 'hermes-agent',
  stripeApiVersion: '2026-08-26.dahlia',
};

const EVENEMENTS_STRIPE = [
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  'charge.dispute.created',
];

function sansBarreFinale(url) {
  return String(url).replace(/\/+$/, '');
}

function reglagesDepuisEnv(env) {
  return {
    supabaseUrl: sansBarreFinale(env.SUPABASE_URL || REGLAGES_PAR_DEFAUT.supabaseUrl),
    hermesUrl: sansBarreFinale(env.HERMES_URL || REGLAGES_PAR_DEFAUT.hermesUrl),
    hermesModel: env.HERMES_MODEL || REGLAGES_PAR_DEFAUT.hermesModel,
    stripeApiVersion: env.STRIPE_API_VERSION || REGLAGES_PAR_DEFAUT.stripeApiVersion,
  };
}

// Identifiant stable (même JSON à chaque build, diff lisible)
function uuidStable(graine) {
  const h = crypto.createHash('sha1').update('jsquare-n8n:' + graine).digest('hex');
  const variante = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-5' + h.slice(13, 16) + '-' + variante + h.slice(17, 20) + '-' + h.slice(20, 32);
}

function lireModule(nom) {
  return fs.readFileSync(path.join(DOSSIER, nom), 'utf8').trimEnd();
}

// ---------------------------------------------------------------------
// Fabriques de nœuds
// ---------------------------------------------------------------------
// id null : à l'import, n8n relie le nœud à l'identifiant qui porte exactement ce nom
function credentiel(cle) {
  const c = IDENTIFIANTS[cle];
  return { [c.type]: { id: null, name: c.nom } };
}

function noeud(workflow, nom, type, version, position, parametres, extra) {
  return Object.assign({
    parameters: parametres,
    id: uuidStable(workflow + ':' + nom),
    name: nom,
    type: type,
    typeVersion: version,
    position: position,
  }, extra || {});
}

function noeudReglages(workflow, position, valeurs) {
  return noeud(workflow, 'Réglages', 'n8n-nodes-base.set', 3.4, position, {
    assignments: {
      assignments: Object.keys(valeurs).map(function (cle) {
        return { id: uuidStable(workflow + ':reglage:' + cle), name: cle, value: valeurs[cle], type: 'string' };
      }),
    },
    options: {},
  });
}

function noeudCode(workflow, nom, position, code) {
  return noeud(workflow, nom, 'n8n-nodes-base.code', 2, position, { mode: 'runOnceForAllItems', jsCode: code });
}

function noeudNote(workflow, nom, position, contenu, largeur, hauteur) {
  return noeud(workflow, nom, 'n8n-nodes-base.stickyNote', 1, position,
    { content: contenu, height: hauteur, width: largeur, color: 5 });
}

// Écriture dans Supabase (PostgREST) avec la clé secrète réservée à n8n
function noeudSupabase(workflow, nom, position, o) {
  const parametres = {
    method: o.methode || 'POST',
    url: '={{ $(\'Réglages\').first().json.supabaseUrl }}/rest/v1/' + o.chemin,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    options: { timeout: 20000 },
  };
  if (o.prefer !== null) {
    parametres.sendHeaders = true;
    parametres.headerParameters = { parameters: [{ name: 'Prefer', value: o.prefer || 'return=minimal' }] };
  }
  if (o.corps) {
    parametres.sendBody = true;
    parametres.specifyBody = 'json';
    parametres.jsonBody = '={{ JSON.stringify(' + o.corps + ') }}';
  }
  return noeud(workflow, nom, 'n8n-nodes-base.httpRequest', 4.2, position, parametres, Object.assign({
    credentials: credentiel('supabase'),
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
  }, o.extra || {}));
}

function regleNonVide(workflow, cle, sortie) {
  return {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{
        id: uuidStable(workflow + ':regle:' + cle),
        leftValue: '={{ ($json.' + cle + ' || []).length }}',
        rightValue: 0,
        operator: { type: 'number', operation: 'gt' },
      }],
      combinator: 'and',
    },
    renameOutput: true,
    outputKey: sortie,
  };
}

// Aiguillage : chaque tableau non vide part vers son nœud d'écriture
function noeudAiguillage(workflow, nom, position, regles) {
  return noeud(workflow, nom, 'n8n-nodes-base.switch', 3.2, position, {
    rules: { values: regles.map(function (r) { return regleNonVide(workflow, r[0], r[1]); }) },
    options: { allMatchingOutputs: true },
  });
}

function lien(cible) {
  return { node: cible, type: 'main', index: 0 };
}

// Lit la sortie d'un autre nœud sans planter s'il n'a pas tourné
const OUTIL_SORTIE = [
  'function sortieDe(nom) {',
  '  try {',
  '    const n = $(nom);',
  '    if (!n.isExecuted) return null;',
  '    const item = n.first();',
  '    return item ? item.json : null;',
  '  } catch (erreur) {',
  '    return null;',
  '  }',
  '}',
].join('\n');

function codeAvecModule(module, colle) {
  return lireModule(module) + '\n\n// ---- Lien avec le workflow n8n (ajouté par build.js) ----\n' + OUTIL_SORTIE + '\n\n' + colle.join('\n') + '\n';
}

// ---------------------------------------------------------------------
// Workflow 1 : stripe-vers-supabase
// ---------------------------------------------------------------------
function construireStripeVersSupabase(reglages) {
  const wf = 'stripe-vers-supabase';
  const nodes = [
    noeudNote(wf, 'À lire', [-80, -260], [
      '## Stripe → Supabase',
      'Chaque paiement Stripe arrive ici et remplit le cash du cockpit.',
      '1. Mets l\'URL de ton projet Supabase dans **Réglages**.',
      '2. Choisis les identifiants « ' + IDENTIFIANTS.stripe.nom + ' » et « ' + IDENTIFIANTS.supabase.nom + ' » dans les nœuds.',
      '3. Active le workflow : n8n crée lui-même le webhook dans Stripe.',
      'Le code des nœuds Code vient de `n8n/stripe-mapping.js` (ne pas le modifier ici).',
    ].join('\n'), 520, 220),
    noeud(wf, 'Stripe', 'n8n-nodes-base.stripeTrigger', 1, [0, 0], {
      events: EVENEMENTS_STRIPE.slice(),
      apiVersion: reglages.stripeApiVersion,
    }, { webhookId: uuidStable(wf + ':webhook'), credentials: credentiel('stripe') }),
    noeudReglages(wf, [220, 0], { supabaseUrl: reglages.supabaseUrl }),
    noeud(wf, 'Taux BCE', 'n8n-nodes-base.httpRequest', 4.2, [440, 0], {
      url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
      options: { response: { response: { responseFormat: 'text', outputPropertyName: 'data' } }, timeout: 8000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    noeudSupabase(wf, 'Taux de secours', [660, 0], {
      methode: 'GET',
      chemin: 'reglages?cle=eq.change&select=valeur',
      prefer: null,
      extra: { onError: 'continueRegularOutput', alwaysOutputData: true },
    }),
    noeudCode(wf, 'Préparer', [880, 0], codeAvecModule('stripe-mapping.js', [
      'const evenement = $(\'Stripe\').first().json;',
      'return [{ json: { evenement: evenement.id, type: evenement.type, urlClient: cibleClientStripe(evenement) || \'\' } }];',
    ])),
    noeud(wf, 'Client à lire ?', 'n8n-nodes-base.if', 2.2, [1100, 0], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: uuidStable(wf + ':condition:client'),
          leftValue: '={{ $json.urlClient }}',
          rightValue: '',
          operator: { type: 'string', operation: 'notEmpty', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    }),
    noeud(wf, 'Lire le client Stripe', 'n8n-nodes-base.httpRequest', 4.2, [1320, -120], {
      url: '={{ $json.urlClient }}',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'stripeApi',
      options: { timeout: 15000 },
    }, {
      credentials: credentiel('stripe'),
      onError: 'continueRegularOutput',
      alwaysOutputData: true,
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 2000,
    }),
    noeudCode(wf, 'Transformer', [1540, 0], codeAvecModule('stripe-mapping.js', [
      'const evenement = $(\'Stripe\').first().json;',
      '// Taux du jour : BCE, sinon le réglage « change » de Supabase',
      'const taux = lireTauxBce((sortieDe(\'Taux BCE\') || {}).data) || lireTauxSecours(sortieDe(\'Taux de secours\'));',
      'const client = sortieDe(\'Lire le client Stripe\');',
      'const lignes = transformerEvenementStripe(evenement, { client: client, tauxUsdEur: taux ? taux.taux : null });',
      'return [{ json: Object.assign({ evenement: evenement.id, type: evenement.type, taux: taux }, lignes) }];',
    ])),
    noeudAiguillage(wf, 'Écrire dans Supabase', [1760, 0], [
      ['clients', 'Fiche client'],
      ['paiements', 'Paiements'],
      ['abonnements', 'Abonnements'],
      ['actions', 'Actions'],
      ['journal', 'Journal'],
    ]),
    // Fiche client créée une seule fois, jamais écrasée (Jay peut la compléter à la main)
    noeudSupabase(wf, 'Créer la fiche client', [2000, -400], {
      chemin: 'clients?on_conflict=stripe_customer_id',
      prefer: 'resolution=ignore-duplicates,return=minimal',
      corps: '$json.clients',
    }),
    noeudSupabase(wf, 'Enregistrer les paiements', [2000, -240], {
      chemin: 'paiements?on_conflict=stripe_event_id',
      prefer: 'resolution=ignore-duplicates,return=minimal',
      corps: '$json.paiements',
    }),
    noeudSupabase(wf, 'Mettre à jour l\'abonnement', [2000, -80], {
      chemin: 'abonnements?on_conflict=stripe_subscription_id',
      prefer: 'resolution=merge-duplicates,return=minimal',
      corps: '$json.abonnements',
    }),
    noeudSupabase(wf, 'Créer l\'action à valider', [2000, 80], {
      chemin: 'actions',
      corps: '$json.actions',
    }),
    noeudSupabase(wf, 'Écrire dans le journal', [2000, 240], {
      chemin: 'journal',
      corps: '$json.journal',
    }),
  ];
  const connections = {
    'Stripe': { main: [[lien('Réglages')]] },
    'Réglages': { main: [[lien('Taux BCE')]] },
    'Taux BCE': { main: [[lien('Taux de secours')]] },
    'Taux de secours': { main: [[lien('Préparer')]] },
    'Préparer': { main: [[lien('Client à lire ?')]] },
    'Client à lire ?': { main: [[lien('Lire le client Stripe')], [lien('Transformer')]] },
    'Lire le client Stripe': { main: [[lien('Transformer')]] },
    'Transformer': { main: [[lien('Écrire dans Supabase')]] },
    'Écrire dans Supabase': {
      main: [
        [lien('Créer la fiche client')],
        [lien('Enregistrer les paiements')],
        [lien('Mettre à jour l\'abonnement')],
        [lien('Créer l\'action à valider')],
        [lien('Écrire dans le journal')],
      ],
    },
  };
  return {
    name: 'stripe-vers-supabase',
    nodes: nodes,
    connections: connections,
    settings: { executionOrder: 'v1', timezone: 'Europe/Paris', saveDataErrorExecution: 'all', saveManualExecutions: true },
    pinData: {},
    active: false,
  };
}

// ---------------------------------------------------------------------
// Workflow 2 : rapport-du-soir
// ---------------------------------------------------------------------
function construireRapportDuSoir(reglages) {
  const wf = 'rapport-du-soir';
  const nodes = [
    noeudNote(wf, 'À lire', [-80, -260], [
      '## Rapport du soir (23:00, heure de Paris)',
      'Hermès lit Supabase en lecture seule et écrit la synthèse du jour.',
      '1. Mets l\'URL Supabase, l\'adresse d\'Hermès et le modèle dans **Réglages**.',
      '2. Choisis les identifiants « ' + IDENTIFIANTS.supabase.nom + ' » et « ' + IDENTIFIANTS.hermes.nom + ' ».',
      '3. Active le workflow.',
      'Le code des nœuds Code vient de `n8n/rapport-du-soir.js` (ne pas le modifier ici).',
    ].join('\n'), 520, 220),
    noeud(wf, 'Chaque soir à 23 h', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], {
      rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 23, triggerAtMinute: 0 }] },
    }),
    noeudReglages(wf, [220, 0], {
      supabaseUrl: reglages.supabaseUrl,
      hermesUrl: reglages.hermesUrl,
      hermesModel: reglages.hermesModel,
    }),
    noeudCode(wf, 'Préparer la demande', [440, 0], codeAvecModule('rapport-du-soir.js', [
      'const reglages = $(\'Réglages\').first().json;',
      'const maintenant = new Date().toISOString();',
      'const jour = jourParis(maintenant);',
      'return [{ json: {',
      '  jour: jour,',
      '  demande: construireDemandeHermes({ jour: jour, modele: reglages.hermesModel }),',
      '  reporter: reporterEnCours(maintenant),',
      '} }];',
    ])),
    noeudSupabase(wf, 'Reporter : en cours', [660, 0], {
      chemin: 'agents_etat?on_conflict=agent',
      prefer: 'resolution=merge-duplicates,return=minimal',
      corps: '[$json.reporter]',
      extra: { onError: 'continueRegularOutput', alwaysOutputData: true, retryOnFail: false },
    }),
    noeud(wf, 'Demander à Hermès', 'n8n-nodes-base.httpRequest', 4.2, [880, 0], {
      method: 'POST',
      url: '={{ $(\'Réglages\').first().json.hermesUrl }}/v1/chat/completions',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($(\'Préparer la demande\').first().json.demande) }}',
      // Hermès lit la base avec ses outils : on lui laisse 10 minutes
      options: { timeout: 600000 },
    }, { credentials: credentiel('hermes'), onError: 'continueRegularOutput', alwaysOutputData: true }),
    noeudCode(wf, 'Lire la réponse', [1100, 0], codeAvecModule('rapport-du-soir.js', [
      'const preparation = $(\'Préparer la demande\').first().json;',
      'const reponse = sortieDe(\'Demander à Hermès\') || {};',
      'const lignes = lireReponseHermes(reponse, { jour: preparation.jour, maintenant: new Date().toISOString() });',
      'return [{ json: lignes }];',
    ])),
    noeudAiguillage(wf, 'Écrire dans Supabase', [1320, 0], [
      ['rapports', 'Rapport'],
      ['messages', 'Message'],
      ['agents_etat', 'État de l\'agent'],
      ['journal', 'Journal'],
    ]),
    noeudSupabase(wf, 'Enregistrer le rapport', [1560, -240], {
      chemin: 'rapports?on_conflict=jour',
      prefer: 'resolution=merge-duplicates,return=minimal',
      corps: '$json.rapports',
    }),
    noeudSupabase(wf, 'Poster dans la messagerie', [1560, -80], {
      chemin: 'messages',
      corps: '$json.messages',
    }),
    noeudSupabase(wf, 'Mettre à jour l\'agent reporter', [1560, 80], {
      chemin: 'agents_etat?on_conflict=agent',
      prefer: 'resolution=merge-duplicates,return=minimal',
      corps: '$json.agents_etat',
    }),
    noeudSupabase(wf, 'Écrire dans le journal', [1560, 240], {
      chemin: 'journal',
      corps: '$json.journal',
    }),
  ];
  const connections = {
    'Chaque soir à 23 h': { main: [[lien('Réglages')]] },
    'Réglages': { main: [[lien('Préparer la demande')]] },
    'Préparer la demande': { main: [[lien('Reporter : en cours')]] },
    'Reporter : en cours': { main: [[lien('Demander à Hermès')]] },
    'Demander à Hermès': { main: [[lien('Lire la réponse')]] },
    'Lire la réponse': { main: [[lien('Écrire dans Supabase')]] },
    'Écrire dans Supabase': {
      main: [
        [lien('Enregistrer le rapport')],
        [lien('Poster dans la messagerie')],
        [lien('Mettre à jour l\'agent reporter')],
        [lien('Écrire dans le journal')],
      ],
    },
  };
  return {
    name: 'rapport-du-soir',
    nodes: nodes,
    connections: connections,
    settings: { executionOrder: 'v1', timezone: 'Europe/Paris', saveDataErrorExecution: 'all', saveManualExecutions: true },
    pinData: {},
    active: false,
  };
}

// ---------------------------------------------------------------------
// Vérification d'un workflow (utilisée par les tests et par --verifier)
// ---------------------------------------------------------------------
function verifierWorkflow(wf) {
  const erreurs = [];
  if (!wf || typeof wf !== 'object') return ['workflow absent'];
  if (typeof wf.name !== 'string' || !wf.name) erreurs.push('nom du workflow absent');
  if (!Array.isArray(wf.nodes) || !wf.nodes.length) erreurs.push('aucun nœud');
  if (!wf.connections || typeof wf.connections !== 'object') erreurs.push('connexions absentes');
  if (!wf.settings || wf.settings.timezone !== 'Europe/Paris') erreurs.push('settings.timezone doit valoir Europe/Paris');
  const noms = new Map();
  const ids = new Set();
  for (const n of wf.nodes || []) {
    if (!n.name || !n.type || n.typeVersion === undefined || !Array.isArray(n.position) || !n.parameters) {
      erreurs.push('nœud incomplet : ' + JSON.stringify(n.name));
    }
    if (noms.has(n.name)) erreurs.push('nom de nœud en double : ' + n.name);
    noms.set(n.name, n);
    if (ids.has(n.id)) erreurs.push('id de nœud en double : ' + n.id);
    ids.add(n.id);
  }
  for (const source of Object.keys(wf.connections || {})) {
    if (!noms.has(source)) erreurs.push('connexion depuis un nœud inconnu : ' + source);
    const sorties = (wf.connections[source] && wf.connections[source].main) || [];
    sorties.forEach(function (liste, i) {
      for (const c of liste || []) {
        if (!noms.has(c.node)) erreurs.push('connexion vers un nœud inconnu : ' + source + ' [' + i + '] -> ' + c.node);
        if (c.type !== 'main') erreurs.push('type de connexion inattendu : ' + source + ' -> ' + c.node);
      }
    });
  }
  // Chaque nœud (hors déclencheur et notes) doit recevoir une connexion
  const recus = new Set();
  for (const source of Object.keys(wf.connections || {})) {
    for (const liste of wf.connections[source].main || []) for (const c of liste || []) recus.add(c.node);
  }
  for (const n of wf.nodes || []) {
    const declencheur = /Trigger$/i.test(n.type);
    if (!declencheur && n.type !== 'n8n-nodes-base.stickyNote' && !recus.has(n.name)) {
      erreurs.push('nœud jamais atteint : ' + n.name);
    }
  }
  // Les nœuds qui utilisent un identifiant doivent le déclarer
  for (const n of wf.nodes || []) {
    const p = n.parameters || {};
    const attendu = p.authentication === 'predefinedCredentialType' ? p.nodeCredentialType
      : p.authentication === 'genericCredentialType' ? p.genericAuthType : null;
    if (attendu && !(n.credentials && n.credentials[attendu])) erreurs.push('identifiant manquant sur ' + n.name);
  }
  return erreurs;
}

function generer(reglages) {
  const r = Object.assign({}, REGLAGES_PAR_DEFAUT, reglages || {});
  return {
    [FICHIERS.stripe]: construireStripeVersSupabase(r),
    [FICHIERS.rapport]: construireRapportDuSoir(r),
  };
}

function enJson(wf) {
  return JSON.stringify(wf, null, 2) + '\n';
}

function principal(argv, env) {
  const fichiers = generer(reglagesDepuisEnv(env));
  let erreurs = 0;
  for (const nom of Object.keys(fichiers)) {
    for (const e of verifierWorkflow(fichiers[nom])) { console.error(nom + ' : ' + e); erreurs++; }
  }
  if (erreurs) return 1;
  if (argv.includes('--verifier')) {
    for (const nom of Object.keys(fichiers)) {
      const chemin = path.join(DOSSIER_WORKFLOWS, nom);
      const actuel = fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf8') : '';
      if (actuel !== enJson(fichiers[nom])) {
        console.error(nom + ' n\'est pas à jour : lance « node n8n/build.js ».');
        erreurs++;
      }
    }
    if (!erreurs) console.log('Workflows à jour.');
    return erreurs ? 1 : 0;
  }
  fs.mkdirSync(DOSSIER_WORKFLOWS, { recursive: true });
  for (const nom of Object.keys(fichiers)) {
    fs.writeFileSync(path.join(DOSSIER_WORKFLOWS, nom), enJson(fichiers[nom]));
    console.log('Écrit : n8n/workflows/' + nom);
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = principal(process.argv.slice(2), process.env);
}

module.exports = {
  generer,
  enJson,
  verifierWorkflow,
  construireStripeVersSupabase,
  construireRapportDuSoir,
  reglagesDepuisEnv,
  REGLAGES_PAR_DEFAUT,
  IDENTIFIANTS,
  EVENEMENTS_STRIPE,
  FICHIERS,
  DOSSIER_WORKFLOWS,
};
