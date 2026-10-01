// Garde les signaux qui parlent de tes produits (et, pour les actualités, de commerce), repère les pays cités,
// marque les urgents et ne laisse passer que ceux jamais vus lors des passages précédents.
const p = $('Paramètres').first().json;
const aujourdhui = $now.toISODate();

const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const debutDeMot = (mot) => new RegExp(`(^|[^\\p{L}])${echapper(mot)}`, 'iu');
const motEntier = (mot) => new RegExp(`(^|[^\\p{L}])${echapper(mot)}($|[^\\p{L}])`, 'iu');
const motEntierOuDebut = (mot) => (mot.length <= 3 ? motEntier(mot) : debutDeMot(mot));
const reglesProduits = p.motsCles.map((m) => [m, debutDeMot(m)]);
const reglesAlerte = p.motsAlerte.map((m) => [m, debutDeMot(m)]);
const reglesCommerce = p.motsCommerce.map((m) => debutDeMot(m));
const reglesProjets = p.mesProjets.map((x) => [x.nom, x.mots.map(debutDeMot)]);
const BAISSE = ['baisse', 'chute', 'effondr', 'recul', 'plonge', 'drop', 'collapse', 'plunge', 'decline', 'slump', 'lose', 'loss'].map(debutDeMot);
const HAUSSE = ['hausse', 'flambée', 'envolée', 'record', 'pénurie', 'manque', 'rupture', 'interdi', 'shortage', 'surge', 'spike', 'soar', 'ban'].map(motEntierOuDebut);
const IMPORT = ['import'].map(debutDeMot);

// Nom français de chaque mot-clé (pour des briefs lisibles)
const EN_FRANCAIS = {
  maize: 'maïs', rice: 'riz', cassava: 'manioc', tapioca: 'manioc', gari: 'manioc', cocoa: 'cacao', coffee: 'café',
  pepper: 'poivre', chili: 'piment', ginger: 'gingembre', sesame: 'sésame', soybean: 'soja', soya: 'soja',
  groundnut: 'arachide', peanut: 'arachide', onion: 'oignon', potato: 'pomme de terre', 'pommes de terre': 'pomme de terre',
  cowpea: 'niébé', sorghum: 'sorgho', millet: 'mil', 'palm oil': 'huile de palme', banana: 'banane',
  pineapple: 'ananas', avocado: 'avocat', mango: 'mangue', cashew: 'cajou', shea: 'karité', kola: 'noix de cola',
  poultry: 'volaille', chicken: 'poulet', egg: 'œufs', oeuf: 'œufs', œuf: 'œufs', fish: 'poisson', seed: 'semences',
  semence: 'semences', fertili: 'engrais', 'animal feed': 'aliment pour bétail', flour: 'farine', cereal: 'céréales',
  céréale: 'céréales', grain: 'céréales', foodstuff: 'denrées alimentaires', 'food supply': 'denrées alimentaires',
  denrée: 'denrées alimentaires', vivres: 'denrées alimentaires', sugar: 'sucre', tomato: 'tomate',
  vegetable: 'légumes', légume: 'légumes', okra: 'gombo', cucumber: 'concombre', watermelon: 'pastèque',
  'sweet potato': 'patate douce', maraîch: 'légumes', avicole: 'volaille', aviculture: 'volaille',
};
const enFrancais = (mots) => [...new Set(mots.map((m) => EN_FRANCAIS[m] || m))];

// Le brief : ce qu'il faut retenir, et ce que tu peux en faire
function brief(s, produits, pays, projets) {
  const produit = produits.slice(0, 2).join(', ');
  const ou = pays ? ` (${pays})` : '';
  const concerne = projets.length ? `Concerne ton projet ${projets.join(' et ')}. ` : '';
  if (s.type === "Appel d'offres") {
    return {
      a_retenir: `${s.acheteur || 'Un acheteur public'}${ou} lance un appel d'offres : « ${s.titre} ». Date limite : ${s.date_limite || 'non précisée'}.`,
      que_faire: projets.length
        ? `${concerne}Lis le dossier (lien) : il faut en général une entreprise enregistrée et parfois une garantie. Si tu peux livrer, contacte l'acheteur avant la date limite (${s.contact || 'contact dans le dossier'}).`
        : `Tu ne produis pas ça. En apporteur d'affaires : signale cet appel d'offres à une entreprise camerounaise capable de livrer (${produit}) et propose de monter le dossier avec elle, contre une commission fixée par écrit.`,
    };
  }
  const titre = s.titre;
  let que;
  if (BAISSE.some((r) => r.test(s.titre))) {
    que = `Prix ou ventes en baisse pour ${produit}${ou} : prudence avant d'investir dans ce produit brut ; la transformation ou un acheteur engagé à l'avance protège mieux.`;
  } else if (HAUSSE.some((r) => r.test(s.titre))) {
    que = `Signe de manque ou de hausse pour ${produit}${ou} : si tu en as ou connais des producteurs, c'est le moment de contacter les acheteurs${pays ? ' de ce pays' : ''}.`;
  } else if (IMPORT.some((r) => r.test(s.titre))) {
    que = `Un marché qui importe (${produit}${ou}) : piste de vente ou de courtage, à creuser en cherchant les importateurs.`;
  } else if (projets.length) {
    que = `Lis-le : ça parle de ta filière. Note les entreprises, banques ou organismes cités : ce sont des contacts possibles.`;
  } else {
    que = `Information de contexte sur ${produit} : à lire si tu travailles sur ce produit, sinon rien à faire.`;
  }
  return { a_retenir: titre, que_faire: concerne + que };
}

const PAYS = [
  ['Cameroun', ['cameroun', 'cameroon']], ['Nigeria', ['nigeria']], ['Gabon', ['gabon']],
  ['Congo', ['congo', 'rdc', 'drc']], ['Tchad', ['tchad', 'chad']], ['Centrafrique', ['centrafrique', 'centrafricaine', 'central african']],
  ['Guinée équatoriale', ['guinée équatoriale', 'equatorial guinea']], ["Côte d'Ivoire", ["côte d'ivoire", "cote d'ivoire", 'ivory coast']],
  ['Ghana', ['ghana']], ['Sénégal', ['sénégal', 'senegal']], ['Bénin', ['bénin', 'benin']], ['Togo', ['togo']],
  ['Niger', ['niger']], ['Mali', ['mali']], ['Burkina Faso', ['burkina']], ['Guinée', ['guinée', 'guinea']],
  ['Maroc', ['maroc', 'morocco']], ['Algérie', ['algérie', 'algeria']], ['Tunisie', ['tunisie', 'tunisia']],
  ['Égypte', ['égypte', 'egypt']], ['Kenya', ['kenya']], ['Éthiopie', ['éthiopie', 'ethiopia']],
  ['Afrique du Sud', ['afrique du sud', 'south africa']], ['Angola', ['angola']], ['Tanzanie', ['tanzanie', 'tanzania']],
  ['France', ['france']], ['Belgique', ['belgique', 'belgium']], ['Pays-Bas', ['pays-bas', 'netherlands']],
  ['Allemagne', ['allemagne', 'germany']], ['Chine', ['chine', 'china']], ['Inde', ['inde', 'india']],
  ['Turquie', ['turquie', 'turkey', 'türkiye']], ['Émirats', ['émirats', 'emirates', 'uae', 'dubai', 'dubaï']],
  ['États-Unis', ['états-unis', 'united states', 'usa']],
].map(([nom, variantes]) => [nom, variantes.map(motEntier)]);

const memoire = $getWorkflowStaticData('global');
memoire.dejaVus ??= [];
const vus = new Set(memoire.dejaVus);

const sorties = [];
for (const item of $input.all()) {
  const s = item.json;
  if (!s.id || vus.has(s.id)) continue;
  const texte = s.texte || s.titre || '';
  const produits = reglesProduits.filter(([, r]) => r.test(texte)).map(([m]) => m);
  if (!produits.length) continue;
  if (s.type === 'Actualité' && !reglesCommerce.some((r) => r.test(texte))) continue;
  vus.add(s.id);
  memoire.dejaVus.push(s.id);

  const alertes = reglesAlerte.filter(([, r]) => r.test(texte)).map(([m]) => m);
  const paysCites = PAYS.filter(([, regles]) => regles.some((r) => r.test(texte))).map(([nom]) => nom);
  const projets = reglesProjets.filter(([, regles]) => regles.some((r) => r.test(texte))).map(([nom]) => nom);
  const pays = s.pays || paysCites.join(', ');
  const listeProduits = enFrancais(produits);
  sorties.push({
    json: {
      date_detection: aujourdhui,
      priorite: s.type === "Appel d'offres" || alertes.length || projets.length ? 'haute' : 'normale',
      concerne_projet: projets.join(', '),
      type: s.type,
      source: s.source,
      pays,
      produits: listeProduits.join(', '),
      titre: s.titre,
      ...brief(s, listeProduits, pays, projets),
      lien: s.lien,
      acheteur: s.acheteur,
      contact: s.contact,
      date_limite: s.date_limite,
      date: s.date,
      statut: 'nouveau',
      notes: '',
      id: s.id,
    },
  });
}

// La mémoire garde les 5 000 derniers signaux vus
memoire.dejaVus = memoire.dejaVus.slice(-5000);

const ordre = (o) => (o.concerne_projet ? 0 : 4) + (o.type === "Appel d'offres" ? 0 : 1) + (o.priorite === 'haute' ? 0 : 2);
sorties.sort((a, b) => ordre(a.json) - ordre(b.json) || String(b.json.date).localeCompare(String(a.json.date)));
return sorties;
