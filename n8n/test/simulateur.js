'use strict';
// Mini-simulateur de n8n pour les tests : exécute un workflow JSON généré par build.js
// avec de faux services HTTP. Il ne connaît que les nœuds utilisés ici (déclencheurs,
// Set, Code, IF, Switch, HTTP Request) et suit les règles utiles de n8n :
// expressions {{ }}, $json, $('Nœud').first() / .isExecuted, alwaysOutputData,
// onError = continueRegularOutput, tableaux JSON découpés en items.

const vm = require('node:vm');

// Même enveloppe que le « JS task runner » de n8n 2.x (createVmExecutableCode dans
// packages/@n8n/task-runner/src/js-task-runner/js-task-runner.ts) : contexte vm isolé,
// prototypes verrouillés, constructeurs gelés, code de l'utilisateur dans une fonction async.
function enveloppeTaskRunner(code) {
  return [
    'globalThis.global = globalThis',
    'var module = { exports: {} }',
    'Object.getPrototypeOf = () => ({})',
    'Reflect.getPrototypeOf = () => ({})',
    'Object.setPrototypeOf = () => false',
    'Reflect.setPrototypeOf = () => false',
    'delete Error.prepareStackTrace',
    'delete Error.captureStackTrace',
    'Object.defineProperty(Error, "prepareStackTrace", { configurable: false, writable: false, value: undefined })',
    'Object.defineProperty(Error, "captureStackTrace", { configurable: false, writable: false, value: undefined })',
    'Object.defineProperty = () => ({})',
    'Object.defineProperties = () => ({})',
    '[Object, Function, Array, String, Number, Boolean, RegExp, Error, TypeError, RangeError, SyntaxError, ReferenceError, Promise, Symbol, Map, Set, WeakMap, WeakSet, Date, JSON, Math, Reflect, ArrayBuffer, DataView, Int8Array, Uint8Array, Float32Array, Float64Array].forEach((constructor) => { try { Object.freeze(constructor); } catch {} })',
    'module.exports = async function VmCodeWrapper() {' + code + '\n}()',
  ].join('; ');
}

// Exécute le code d'un nœud Code comme n8n ; le résultat repasse par JSON (comme les items n8n)
async function executerCode(code, globales) {
  const contexte = vm.createContext(Object.assign({ __isExecutionContext: true, console: console }, globales));
  const resultat = await vm.runInContext(enveloppeTaskRunner(code), contexte, { timeout: 5000 });
  return JSON.parse(JSON.stringify(resultat));
}

function accesNoeuds(sorties) {
  return function $(nom) {
    const items = sorties.get(nom);
    return {
      isExecuted: items !== undefined,
      first: function () {
        if (!items) throw new Error('Le nœud « ' + nom + ' » n\'a pas encore tourné');
        return items[0];
      },
      all: function () { return items || []; },
    };
  };
}

// Évalue une valeur de paramètre : « ={{ expr }} texte {{ expr }} » ou valeur simple
function evaluer(valeur, contexte) {
  if (typeof valeur !== 'string' || valeur[0] !== '=') return valeur;
  const modele = valeur.slice(1);
  const calcul = function (expr) {
    return new Function('$json', '$', 'return (' + expr + ');')(contexte.json, contexte.$);
  };
  const seul = modele.match(/^\{\{([\s\S]*)\}\}$/);
  if (seul && seul[1].indexOf('{{') < 0) return calcul(seul[1]);
  return modele.replace(/\{\{([\s\S]*?)\}\}/g, function (_, expr) { return String(calcul(expr)); });
}

function condition(c, contexte) {
  const gauche = evaluer(c.leftValue, contexte);
  const droite = evaluer(c.rightValue, contexte);
  const op = c.operator.type + ':' + c.operator.operation;
  switch (op) {
    case 'string:notEmpty': return typeof gauche === 'string' && gauche.length > 0;
    case 'string:equals': return gauche === droite;
    case 'number:gt':
      if (typeof gauche !== 'number') throw new Error('validation stricte : nombre attendu, reçu ' + typeof gauche);
      return gauche > droite;
    default: throw new Error('opérateur non simulé : ' + op);
  }
}

function conditionsVraies(bloc, contexte) {
  const resultats = bloc.conditions.map(function (c) { return condition(c, contexte); });
  return bloc.combinator === 'or' ? resultats.some(Boolean) : resultats.every(Boolean);
}

function enItems(reponse) {
  if (reponse === undefined || reponse === null || reponse === '') return [];
  if (Array.isArray(reponse)) return reponse.map(function (j) { return { json: j }; });
  return [{ json: reponse }];
}

async function noeudHttp(noeud, item, contexte, http) {
  const p = noeud.parameters;
  const entetes = {};
  if (p.sendHeaders) for (const h of p.headerParameters.parameters) entetes[h.name] = evaluer(h.value, contexte);
  let corps;
  if (p.sendBody && p.specifyBody === 'json') {
    const brut = evaluer(p.jsonBody, contexte);
    corps = typeof brut === 'string' ? JSON.parse(brut) : brut;
  }
  const authentification = p.authentication === 'predefinedCredentialType' ? p.nodeCredentialType
    : p.authentication === 'genericCredentialType' ? p.genericAuthType : null;
  const requete = {
    noeud: noeud.name,
    methode: p.method || 'GET',
    url: evaluer(p.url, contexte),
    entetes: entetes,
    corps: corps,
    authentification: authentification,
    identifiant: authentification && noeud.credentials && noeud.credentials[authentification]
      ? noeud.credentials[authentification].name : null,
  };
  const reponse = await http(requete);
  const format = p.options && p.options.response && p.options.response.response;
  if (format && format.responseFormat === 'text') return [{ json: { [format.outputPropertyName || 'data']: reponse } }];
  return enItems(reponse);
}

async function executerNoeud(noeud, items, sorties, options) {
  const $ = accesNoeuds(sorties);
  const ctx = function (item) { return { json: item ? item.json : {}, $: $ }; };
  switch (noeud.type) {
    case 'n8n-nodes-base.set': {
      const json = {};
      for (const a of noeud.parameters.assignments.assignments) json[a.name] = evaluer(a.value, ctx(items[0]));
      return [[{ json: json }]];
    }
    case 'n8n-nodes-base.code': {
      const resultat = await executerCode(noeud.parameters.jsCode, {
        $: $,
        $input: { all: function () { return items; }, first: function () { return items[0]; } },
      });
      if (!Array.isArray(resultat)) throw new Error('Le nœud Code « ' + noeud.name + ' » doit renvoyer un tableau');
      return [resultat];
    }
    case 'n8n-nodes-base.if': {
      const vrai = [];
      const faux = [];
      for (const it of items) (conditionsVraies(noeud.parameters.conditions, ctx(it)) ? vrai : faux).push(it);
      return [vrai, faux];
    }
    case 'n8n-nodes-base.switch': {
      const regles = noeud.parameters.rules.values;
      const tous = noeud.parameters.options && noeud.parameters.options.allMatchingOutputs;
      const sortiesSwitch = regles.map(function () { return []; });
      for (const it of items) {
        for (let i = 0; i < regles.length; i++) {
          if (conditionsVraies(regles[i].conditions, ctx(it))) {
            sortiesSwitch[i].push(it);
            if (!tous) break;
          }
        }
      }
      return sortiesSwitch;
    }
    case 'n8n-nodes-base.httpRequest': {
      const resultat = [];
      for (const it of items) resultat.push.apply(resultat, await noeudHttp(noeud, it, ctx(it), options.http));
      return [resultat];
    }
    default:
      throw new Error('type de nœud non simulé : ' + noeud.type);
  }
}

// Exécute le workflow à partir de son déclencheur, branche après branche (ordre v1)
async function executerWorkflow(wf, options) {
  const parNom = new Map(wf.nodes.map(function (n) { return [n.name, n]; }));
  const declencheur = wf.nodes.find(function (n) { return /Trigger$/i.test(n.type); });
  const sorties = new Map();
  const ordre = [];
  const erreurs = [];
  const pile = [];

  function suivre(nom, sortiesNoeud) {
    const liens = (wf.connections[nom] && wf.connections[nom].main) || [];
    // ordre v1 : la première sortie d'abord (pile => on empile à l'envers)
    for (let i = liens.length - 1; i >= 0; i--) {
      const items = sortiesNoeud[i] || [];
      if (!items.length) continue;
      for (let k = liens[i].length - 1; k >= 0; k--) pile.push({ nom: liens[i][k].node, items: items });
    }
  }

  const depart = [{ json: options.declencheur }];
  sorties.set(declencheur.name, depart);
  ordre.push(declencheur.name);
  suivre(declencheur.name, [depart]);
  while (pile.length) {
    const etape = pile.pop();
    const noeud = parNom.get(etape.nom);
    if (!noeud) throw new Error('nœud inconnu : ' + etape.nom);
    let resultat;
    try {
      resultat = await executerNoeud(noeud, etape.items, sorties, options);
    } catch (erreur) {
      if (noeud.onError === 'continueRegularOutput') {
        resultat = [[{ json: { error: { message: erreur.message } } }]];
      } else {
        erreurs.push({ noeud: noeud.name, message: erreur.message });
        continue;
      }
    }
    if (noeud.alwaysOutputData && !(resultat[0] && resultat[0].length)) resultat[0] = [{ json: {} }];
    sorties.set(noeud.name, resultat[0] || []);
    ordre.push(noeud.name);
    suivre(noeud.name, resultat);
  }
  return { sorties: sorties, ordre: ordre, erreurs: erreurs };
}

module.exports = { executerWorkflow, executerCode, evaluer };
