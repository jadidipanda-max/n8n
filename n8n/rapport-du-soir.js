'use strict';
// =====================================================================
// rapport-du-soir.js : la demande envoyée à Hermès à 23:00 et la lecture
// de sa réponse en lignes Supabase (rapports, messages, agents_etat, journal).
// Contrat : cockpit/CONTRAT-TECHNIQUE.md, section 4 (rapport-du-soir).
//
// Fonctions pures (l'heure est toujours passée en paramètre). Ce fichier est
// collé tel quel dans les nœuds Code du workflow par build.js.
// =====================================================================

const VERDICTS = ['tenir', 'ajuster_prix', 'changer_niche', 'changer_offre', 'alerte'];
const VERDICT_PAR_DEFAUT = 'tenir';
const AGENT_REPORTER = 'reporter';
const NOM_REPORTER = 'Rapport du soir';
const LIMITE_MESSAGE = 8000; // messages.contenu : 8000 caractères au plus

function enTexte(valeur) {
  return String(valeur === null || valeur === undefined ? '' : valeur);
}

function couper(t, max) {
  const s = enTexte(t).trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Date du jour à Paris, au format AAAA-MM-JJ
function jourParis(maintenant) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(maintenant))) p[x.type] = x.value;
  return p.year + '-' + p.month + '-' + p.day;
}

// « 2026-10-04 » -> « 4 octobre »
function jourLisible(jour) {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(jour + 'T12:00:00Z'));
}

// Écart (minutes) entre l'heure de Paris et l'heure UTC à un instant donné
function decalageParis(instant) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant))) p[x.type] = x.value;
  const commeUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((commeUtc - instant) / 60000);
}

// Instant UTC qui correspond à « jour à hh:mm, heure de Paris »
function heureParis(jour, heure, minute) {
  const [a, m, j] = jour.split('-').map(Number);
  const local = Date.UTC(a, m - 1, j, heure, minute);
  let instant = local - decalageParis(local) * 60000;
  instant = local - decalageParis(instant) * 60000;
  return new Date(instant);
}

// Prochain passage du rapport (23:00 à Paris) après « maintenant »
function prochainRapport(maintenant) {
  const t = new Date(maintenant).getTime();
  const aujourdhui = heureParis(jourParis(t), 23, 0);
  if (aujourdhui.getTime() > t + 60000) return aujourdhui.toISOString();
  const demain = jourParis(t + 24 * 3600 * 1000);
  return heureParis(demain, 23, 0).toISOString();
}

// ---------------------------------------------------------------------
// Demande envoyée à Hermès (API compatible OpenAI : /v1/chat/completions)
// ---------------------------------------------------------------------
function construireDemandeHermes(options) {
  const jour = options.jour;
  const modele = options.modele || 'hermes-agent';
  const systeme = [
    'Tu es Hermès, le centre de contrôle de J-Square : Jay vend en France, Junior aux États-Unis.',
    'Ce soir tu joues l\'agent reporter.',
    'Tu lis la base Supabase du cockpit en lecture seule avec ton outil MCP Supabase.',
    'Tu n\'écris rien dans la base et tu ne déclenches aucune action réelle :',
    'toute action passe par la table actions et la validation de Jay.',
  ].join(' ');
  const consigne = [
    'Écris le rapport du soir du ' + jourLisible(jour) + ' (' + jour + ', heure de Paris).',
    '',
    'Lis au minimum : v_cash_resume, v_cash_attendu, v_seuils, v_partage, les paiements et le journal du jour,',
    'abonnements, clients, appels (comptes par écran et par statut), actions en attente, objectifs du mois.',
    'Croise avec des sources externes si tu en as. Puis juge s\'il faut changer de trajectoire ou de prix.',
    '',
    'Réponds uniquement avec un objet JSON, sans texte autour, de cette forme :',
    '{"verdict": "tenir | ajuster_prix | changer_niche | changer_offre | alerte",',
    ' "resume": "une phrase de 200 caractères au plus",',
    ' "contenu": "le rapport complet, 15 lignes au plus, une idée par ligne",',
    ' "donnees": {"appels_fr": 0, "joints_fr": 0, "demos_fr": 0, "appels_us": 0, "joints_us": 0, "demos_us": 0,',
    '             "demos_total": 0, "demos_necessaires": 20}}',
    '',
    'Dans « donnees », des nombres entiers seulement : appels passés, gérants joints et démos prises aujourd\'hui',
    'par marché (table appels), « demos_total » = démos prises depuis le début de l\'offre actuelle,',
    '« demos_necessaires » = démos qu\'il faut pour juger le prix (20 sauf avis contraire de Jay).',
    'Si un chiffre est inconnu, mets null : n\'invente rien.',
    '',
    'Écris pour Jay, qui n\'est pas développeur : français simple, pas de jargon,',
    'euros pour la France, dollars pour les USA. « alerte » seulement si un problème demande une décision ce soir.',
  ].join('\n');
  return {
    model: modele,
    stream: false,
    messages: [
      { role: 'system', content: systeme },
      { role: 'user', content: consigne },
    ],
  };
}

// ---------------------------------------------------------------------
// Lecture de la réponse d'Hermès
// ---------------------------------------------------------------------
function texteDeReponse(reponse) {
  if (!reponse || typeof reponse !== 'object' || reponse.error) return null;
  const choix = Array.isArray(reponse.choices) ? reponse.choices[0] : null;
  const contenu = choix && choix.message ? choix.message.content : null;
  if (typeof contenu === 'string') return contenu.trim() || null;
  if (Array.isArray(contenu)) {
    const t = contenu.map(function (p) { return p && typeof p.text === 'string' ? p.text : ''; }).join('').trim();
    return t || null;
  }
  return null;
}

// Cherche un objet JSON : réponse entière, bloc ```json, ou du premier { au dernier }
function extraireJson(t) {
  const essais = [t];
  const bloc = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (bloc) essais.push(bloc[1].trim());
  const debut = t.indexOf('{');
  const fin = t.lastIndexOf('}');
  if (debut >= 0 && fin > debut) essais.push(t.slice(debut, fin + 1));
  for (const e of essais) {
    try {
      const o = JSON.parse(e);
      if (o && typeof o === 'object' && !Array.isArray(o)) return o;
    } catch (erreur) { /* essai suivant */ }
  }
  return null;
}

function normaliserVerdict(brut) {
  const v = enTexte(brut).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
  if (!v) return null;
  if (VERDICTS.indexOf(v) >= 0) return v;
  if (/^tenir/.test(v) || v === 'garder_le_cap') return 'tenir';
  if (/ajuster.*prix|changer.*prix|baisser.*prix|monter.*prix/.test(v)) return 'ajuster_prix';
  if (/niche/.test(v)) return 'changer_niche';
  if (/offre/.test(v)) return 'changer_offre';
  if (/alerte|urgence/.test(v)) return 'alerte';
  return null;
}

// En texte libre : verdict lu après « Verdict : », sinon « tenir »
function verdictDansTexte(t) {
  const m = t.match(/verdict\s*[:：-]\s*([^\n.;,]+)/i);
  return (m && normaliserVerdict(m[1])) || VERDICT_PAR_DEFAUT;
}

// Première vraie ligne d'un texte, sans la mise en forme Markdown
function premiereLigne(t) {
  const lignes = t.split('\n').map(function (l) { return l.replace(/^[\s#>*\-•]+/, '').replace(/\*\*/g, '').trim(); });
  return lignes.find(function (l) { return l.length > 0 && !/^rapport du/i.test(l); }) || lignes.find(Boolean) || '';
}

function lireReponseHermes(reponse, options) {
  const jour = options.jour;
  const maintenant = new Date(options.maintenant).toISOString();
  const lisible = jourLisible(jour);
  const brut = texteDeReponse(reponse);

  if (!brut) {
    const detail = reponse && reponse.error
      ? couper(reponse.error.message || reponse.error.description || JSON.stringify(reponse.error), 300)
      : 'réponse vide';
    return {
      ok: false,
      rapports: [],
      messages: [{
        auteur: 'systeme', marche: null, type: 'alerte',
        contenu: couper('Le rapport du soir du ' + lisible + ' n\'a pas pu être écrit : Hermès ne répond pas (' + detail + '). ' +
          'n8n réessaiera demain à 23:00. Tu peux aussi relancer le workflow « rapport-du-soir » à la main dans n8n.', LIMITE_MESSAGE),
        meta: { rapport: jour, erreur: detail },
      }],
      agents_etat: [{
        agent: AGENT_REPORTER, nom: NOM_REPORTER, statut: 'err',
        derniere_phrase: 'Hermès n\'a pas répondu ce soir.',
        derniere_execution: maintenant, prochaine_execution: prochainRapport(maintenant),
      }],
      journal: [{ marche: null, agent: AGENT_REPORTER, texte: 'Rapport du ' + lisible + ' non écrit : Hermès ne répond pas.' }],
    };
  }

  const objet = extraireJson(brut);
  let verdict;
  let resume;
  let contenu;
  let donnees = {};
  let format;
  if (objet && (objet.contenu || objet.resume)) {
    format = 'json';
    contenu = enTexte(objet.contenu || objet.resume).trim();
    resume = enTexte(objet.resume).trim() || premiereLigne(contenu);
    verdict = normaliserVerdict(objet.verdict) || verdictDansTexte(contenu);
    if (objet.donnees && typeof objet.donnees === 'object' && !Array.isArray(objet.donnees)) donnees = objet.donnees;
    if (objet.verdict && !normaliserVerdict(objet.verdict)) donnees = Object.assign({}, donnees, { verdict_hermes: enTexte(objet.verdict) });
  } else {
    // Hermès a répondu en texte libre : on garde tout le texte
    format = 'texte_libre';
    contenu = brut;
    resume = premiereLigne(brut);
    verdict = verdictDansTexte(brut);
  }
  resume = couper(resume, 280);
  donnees = Object.assign({}, donnees, {
    format: format,
    modele: reponse.model || null,
    jetons: reponse.usage && reponse.usage.total_tokens ? reponse.usage.total_tokens : null,
  });

  const entete = 'Rapport du ' + lisible + ' · verdict : ' + verdict.replace(/_/g, ' ');
  const corps = contenu.indexOf(resume.replace(/…$/, '')) >= 0 ? contenu : resume + '\n\n' + contenu;
  return {
    ok: true,
    rapports: [{ jour: jour, verdict: verdict, resume: resume, contenu: contenu, donnees: donnees }],
    messages: [{
      auteur: 'hermes', marche: null, type: 'rapport',
      contenu: couper(entete + '\n' + corps, LIMITE_MESSAGE),
      meta: { rapport: jour, verdict: verdict },
    }],
    agents_etat: [{
      agent: AGENT_REPORTER, nom: NOM_REPORTER, statut: 'ok',
      derniere_phrase: couper('Rapport du ' + lisible + ' : ' + resume, 200),
      derniere_execution: maintenant, prochaine_execution: prochainRapport(maintenant),
    }],
    journal: [{ marche: null, agent: AGENT_REPORTER, texte: couper('Rapport du ' + lisible + ' écrit. Verdict : ' + verdict.replace(/_/g, ' ') + '.', 500) }],
  };
}

// État « en cours » posé au début du workflow
function reporterEnCours(maintenant) {
  return {
    agent: AGENT_REPORTER, nom: NOM_REPORTER, statut: 'run',
    derniere_phrase: 'J\'écris le rapport du soir.',
    derniere_execution: new Date(maintenant).toISOString(),
    prochaine_execution: prochainRapport(maintenant),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    construireDemandeHermes,
    lireReponseHermes,
    reporterEnCours,
    extraireJson,
    normaliserVerdict,
    jourParis,
    jourLisible,
    heureParis,
    prochainRapport,
    VERDICTS,
  };
}
