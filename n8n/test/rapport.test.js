'use strict';
// Tests de rapport-du-soir.js : demande à Hermès et lecture de sa réponse.
// Lancer avec : node --test n8n/test/*.test.js

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const r = require('../rapport-du-soir.js');
const { colonnesMigration, verifierColonnes } = require('./outils.js');

const TABLES = colonnesMigration();
const JOUR = '2026-10-04';
const MAINTENANT = '2026-10-04T21:00:07.000Z'; // 23:00:07 à Paris (heure d'été)

// Réponse type de l'API Hermès (format OpenAI chat.completion)
function reponseHermes(contenu) {
  return {
    id: 'chatcmpl-8f2a1c',
    object: 'chat.completion',
    created: 1791147607,
    model: 'hermes-agent',
    choices: [{ index: 0, message: { role: 'assistant', content: contenu }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5120, completion_tokens: 410, total_tokens: 5530 },
  };
}

const JSON_PROPRE = JSON.stringify({
  verdict: 'tenir',
  resume: 'Tenir le cap : 12 démos sur les 20 nécessaires pour juger le prix.',
  contenu: 'France : 83 appels, 47 gérants joints, 2 démos prises.\nUSA : 41 appels, 1 démo prise.\nCash du mois : 3 628 €.\nVerdict : tenir le cap.',
  donnees: { appels_fr: 83, demos_fr: 2, appels_us: 41, demos_us: 1 },
});

function verifierLignes(sortie) {
  verifierColonnes(assert, TABLES, 'rapports', sortie.rapports);
  verifierColonnes(assert, TABLES, 'messages', sortie.messages);
  verifierColonnes(assert, TABLES, 'agents_etat', sortie.agents_etat);
  verifierColonnes(assert, TABLES, 'journal', sortie.journal);
  for (const m of sortie.messages) {
    assert.ok(m.contenu.length <= 8000, 'messages.contenu dépasse 8000 caractères');
    assert.ok(['hermes', 'systeme'].includes(m.auteur));
    assert.ok(['rapport', 'alerte'].includes(m.type));
  }
  for (const a of sortie.agents_etat) {
    assert.equal(a.agent, 'reporter');
    assert.ok(['run', 'wait', 'idle', 'ok', 'err'].includes(a.statut));
    assert.ok(a.nom);
  }
  for (const rap of sortie.rapports) assert.ok(r.VERDICTS.includes(rap.verdict));
}

describe('demande envoyée à Hermès', () => {
  test('format OpenAI : modèle, pas de flux, consigne JSON {verdict, resume, contenu}', () => {
    const d = r.construireDemandeHermes({ jour: JOUR, modele: 'hermes-agent' });
    assert.equal(d.model, 'hermes-agent');
    assert.equal(d.stream, false);
    assert.equal(d.messages.length, 2);
    assert.equal(d.messages[0].role, 'system');
    assert.equal(d.messages[1].role, 'user');
    assert.match(d.messages[0].content, /lecture seule/);
    assert.match(d.messages[0].content, /table actions/);
    const consigne = d.messages[1].content;
    assert.match(consigne, /4 octobre/);
    assert.match(consigne, /2026-10-04/);
    for (const mot of ['"verdict"', '"resume"', '"contenu"', 'tenir', 'ajuster_prix', 'changer_niche', 'changer_offre', 'alerte']) {
      assert.ok(consigne.includes(mot), 'consigne sans ' + mot);
    }
    assert.equal(r.construireDemandeHermes({ jour: JOUR }).model, 'hermes-agent');
  });
});

describe('lecture de la réponse', () => {
  test('JSON propre : rapport, message de type rapport, agent ok, journal', () => {
    const s = r.lireReponseHermes(reponseHermes(JSON_PROPRE), { jour: JOUR, maintenant: MAINTENANT });
    verifierLignes(s);
    assert.equal(s.ok, true);
    assert.deepEqual(s.rapports[0], {
      jour: JOUR,
      verdict: 'tenir',
      resume: 'Tenir le cap : 12 démos sur les 20 nécessaires pour juger le prix.',
      contenu: 'France : 83 appels, 47 gérants joints, 2 démos prises.\nUSA : 41 appels, 1 démo prise.\nCash du mois : 3 628 €.\nVerdict : tenir le cap.',
      donnees: { appels_fr: 83, demos_fr: 2, appels_us: 41, demos_us: 1, format: 'json', modele: 'hermes-agent', jetons: 5530 },
    });
    const msg = s.messages[0];
    assert.equal(msg.auteur, 'hermes');
    assert.equal(msg.type, 'rapport');
    assert.equal(msg.marche, null);
    assert.deepEqual(msg.meta, { rapport: JOUR, verdict: 'tenir' });
    assert.match(msg.contenu, /^Rapport du 4 octobre · verdict : tenir\n/);
    assert.match(msg.contenu, /France : 83 appels/);
    const agent = s.agents_etat[0];
    assert.equal(agent.statut, 'ok');
    assert.equal(agent.derniere_execution, MAINTENANT);
    assert.equal(agent.prochaine_execution, '2026-10-05T21:00:00.000Z');
    assert.match(agent.derniere_phrase, /^Rapport du 4 octobre : Tenir le cap/);
    assert.equal(s.journal[0].texte, 'Rapport du 4 octobre écrit. Verdict : tenir.');
  });

  test('JSON dans un bloc ```json entouré de texte', () => {
    const texte = 'Voici le rapport du jour.\n```json\n' + JSON.stringify({
      verdict: 'ajuster_prix', resume: 'Le prix Essentiel est sous le plancher.', contenu: 'Plancher à 672 €.\nVerdict : ajuster le prix.',
    }) + '\n```\nBonne soirée !';
    const s = r.lireReponseHermes(reponseHermes(texte), { jour: JOUR, maintenant: MAINTENANT });
    verifierLignes(s);
    assert.equal(s.rapports[0].verdict, 'ajuster_prix');
    assert.equal(s.rapports[0].resume, 'Le prix Essentiel est sous le plancher.');
    assert.equal(s.rapports[0].donnees.format, 'json');
  });

  test('verdict écrit autrement (accents, espaces) : normalisé', () => {
    assert.equal(r.normaliserVerdict('Ajuster le prix'), 'ajuster_prix');
    assert.equal(r.normaliserVerdict('changer de niche'), 'changer_niche');
    assert.equal(r.normaliserVerdict('Changer l\'offre'), 'changer_offre');
    assert.equal(r.normaliserVerdict('ALERTE'), 'alerte');
    assert.equal(r.normaliserVerdict('tenir le cap'), 'tenir');
    assert.equal(r.normaliserVerdict('peut-être'), null);
    assert.equal(r.normaliserVerdict(undefined), null);
  });

  test('verdict inconnu dans le JSON : « tenir », et le mot d\'Hermès est gardé', () => {
    const s = r.lireReponseHermes(reponseHermes(JSON.stringify({ verdict: 'on verra', resume: 'Journée calme.', contenu: 'Rien à signaler.' })),
      { jour: JOUR, maintenant: MAINTENANT });
    assert.equal(s.rapports[0].verdict, 'tenir');
    assert.equal(s.rapports[0].donnees.verdict_hermes, 'on verra');
  });

  test('texte libre : tout le texte est gardé, verdict lu après « Verdict : »', () => {
    const texte = '## Rapport du 4 octobre\n**Cash du mois : 3 628 €**, en avance sur l\'objectif.\n- 2 démos en France.\nVerdict : changer de niche pour les USA.';
    const s = r.lireReponseHermes(reponseHermes(texte), { jour: JOUR, maintenant: MAINTENANT });
    verifierLignes(s);
    assert.equal(s.ok, true);
    assert.equal(s.rapports[0].contenu, texte);
    assert.equal(s.rapports[0].verdict, 'changer_niche');
    assert.equal(s.rapports[0].resume, 'Cash du mois : 3 628 €, en avance sur l\'objectif.');
    assert.equal(s.rapports[0].donnees.format, 'texte_libre');
  });

  test('texte libre sans verdict : « tenir »', () => {
    const s = r.lireReponseHermes(reponseHermes('Journée calme, 60 appels, aucune démo.'), { jour: JOUR, maintenant: MAINTENANT });
    assert.equal(s.rapports[0].verdict, 'tenir');
    assert.equal(s.rapports[0].resume, 'Journée calme, 60 appels, aucune démo.');
  });

  test('contenu en morceaux (tableau de parts texte)', () => {
    const rep = reponseHermes(null);
    rep.choices[0].message.content = [{ type: 'text', text: JSON_PROPRE.slice(0, 40) }, { type: 'text', text: JSON_PROPRE.slice(40) }];
    const s = r.lireReponseHermes(rep, { jour: JOUR, maintenant: MAINTENANT });
    assert.equal(s.ok, true);
    assert.equal(s.rapports[0].verdict, 'tenir');
  });

  test('rapport très long : le message reste sous 8000 caractères, le rapport garde tout', () => {
    const long = 'Ligne du rapport avec des chiffres.\n'.repeat(400);
    const s = r.lireReponseHermes(reponseHermes(JSON.stringify({ verdict: 'tenir', resume: 'Long.', contenu: long })),
      { jour: JOUR, maintenant: MAINTENANT });
    verifierLignes(s);
    assert.equal(s.rapports[0].contenu, long.trim());
    assert.ok(s.messages[0].contenu.length <= 8000);
  });

  test('Hermès ne répond pas : alerte système, agent en erreur, pas de rapport', () => {
    const erreur = { error: { message: 'connect ECONNREFUSED 172.17.0.1:8642', name: 'NodeApiError' } };
    const s = r.lireReponseHermes(erreur, { jour: JOUR, maintenant: MAINTENANT });
    verifierLignes(s);
    assert.equal(s.ok, false);
    assert.equal(s.rapports.length, 0);
    assert.equal(s.messages[0].auteur, 'systeme');
    assert.equal(s.messages[0].type, 'alerte');
    assert.match(s.messages[0].contenu, /n'a pas pu être écrit : Hermès ne répond pas \(connect ECONNREFUSED/);
    assert.equal(s.agents_etat[0].statut, 'err');
    assert.match(s.journal[0].texte, /non écrit/);
    for (const vide of [{}, null, reponseHermes(''), { choices: [] }]) {
      assert.equal(r.lireReponseHermes(vide, { jour: JOUR, maintenant: MAINTENANT }).ok, false);
    }
  });

  test('état « en cours » posé au début', () => {
    const e = r.reporterEnCours(MAINTENANT);
    verifierColonnes(assert, TABLES, 'agents_etat', [e]);
    assert.equal(e.statut, 'run');
    assert.equal(e.agent, 'reporter');
  });
});

describe('heures de Paris', () => {
  test('jourParis : le jour à Paris, pas en UTC', () => {
    assert.equal(r.jourParis('2026-10-04T21:00:00Z'), '2026-10-04');
    assert.equal(r.jourParis('2026-10-04T22:30:00Z'), '2026-10-05');
    assert.equal(r.jourParis('2026-12-31T23:30:00Z'), '2027-01-01');
  });

  test('heureParis : heure d\'été et heure d\'hiver', () => {
    assert.equal(r.heureParis('2026-10-04', 23, 0).toISOString(), '2026-10-04T21:00:00.000Z');
    assert.equal(r.heureParis('2026-10-25', 23, 0).toISOString(), '2026-10-25T22:00:00.000Z'); // jour du changement d'heure
    assert.equal(r.heureParis('2026-12-01', 23, 0).toISOString(), '2026-12-01T22:00:00.000Z');
    assert.equal(r.heureParis('2027-03-28', 23, 0).toISOString(), '2027-03-28T21:00:00.000Z');
  });

  test('prochainRapport : ce soir 23:00, ou demain si 23:00 est passé', () => {
    assert.equal(r.prochainRapport('2026-10-04T10:00:00Z'), '2026-10-04T21:00:00.000Z');
    assert.equal(r.prochainRapport(MAINTENANT), '2026-10-05T21:00:00.000Z');
    assert.equal(r.prochainRapport('2026-10-24T21:00:30Z'), '2026-10-25T22:00:00.000Z');
  });

  test('jourLisible', () => {
    assert.equal(r.jourLisible('2026-10-04'), '4 octobre');
    assert.equal(r.jourLisible('2027-01-01'), '1 janvier');
  });
});
