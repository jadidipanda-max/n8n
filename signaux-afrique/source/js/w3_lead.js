// Lit chaque email de plateforme B2B (Go4WorldBusiness, Tridge, TradeKey…) et en tire une fiche contact :
// achat ou vente, produits, pays, quantité, coordonnées, et points de vigilance (arnaques fréquentes).
const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const debutDeMot = (mot) => new RegExp(`(^|[^\\p{L}])${echapper(mot)}`, 'iu');
const motEntier = (mot) => new RegExp(`(^|[^\\p{L}])${echapper(mot)}($|[^\\p{L}])`, 'iu');
const trouver = (texte, liste, regle) =>
  liste.filter(([, variantes]) => variantes.some((v) => regle(v).test(texte))).map(([nom]) => nom);

const PRODUITS = [
  ['Cacao', ['cocoa', 'cacao']], ['Café', ['coffee', 'café']], ['Poivre / piment', ['pepper', 'poivre', 'chili', 'piment']],
  ['Gingembre', ['ginger', 'gingembre']], ['Sésame', ['sesame', 'sésame']], ['Cajou', ['cashew', 'cajou']],
  ['Karité', ['shea', 'karité']], ['Maïs', ['maize', 'yellow corn', 'white corn', 'maïs']], ['Riz', ['rice', 'riz']],
  ['Manioc / gari', ['cassava', 'manioc', 'gari', 'tapioca']], ['Soja', ['soybean', 'soya', 'soja']],
  ['Arachide', ['groundnut', 'peanut', 'arachide']], ['Haricot / niébé', ['kidney bean', 'white bean', 'red bean', 'dry bean', 'black-eyed', 'haricot', 'cowpea', 'niébé']],
  ['Huile de palme', ['palm oil', 'huile de palme', 'palm kernel']], ['Banane / plantain', ['banana', 'plantain', 'banane']],
  ['Ananas', ['pineapple', 'ananas']], ['Avocat', ['avocado', 'avocat']], ['Mangue', ['mango', 'mangue']],
  ['Oignon', ['onion', 'oignon']], ['Volaille / œufs', ['poultry', 'chicken', 'eggs', 'volaille', 'poulet', 'œuf', 'oeuf']],
  ['Légumes', ['vegetable', 'légume', 'tomato', 'tomate', 'okra', 'gombo', 'cucumber', 'concombre', 'watermelon', 'pastèque', 'eggplant', 'aubergine']],
  ['Poisson', ['fish', 'poisson', 'tilapia', 'catfish', 'silure']], ['Bois', ['timber', 'sawn wood', 'bois']],
  ['Engrais / semences', ['fertilizer', 'fertiliser', 'engrais', 'seed', 'semence']], ['Sucre', ['sugar', 'sucre']],
  ['Blé', ['wheat', 'blé']], ['Farines', ['flour', 'farine']], ['Noix de cola', ['kola', 'cola nut', 'noix de cola']],
];
const PAYS = [
  ['Cameroun', ['cameroon', 'cameroun']], ['Nigeria', ['nigeria']], ['Gabon', ['gabon']], ['Congo', ['congo']],
  ['Tchad', ['chad', 'tchad']], ['Ghana', ['ghana']], ["Côte d'Ivoire", ["côte d'ivoire", "cote d'ivoire", 'ivory coast']],
  ['Sénégal', ['senegal', 'sénégal']], ['Maroc', ['morocco', 'maroc']], ['Égypte', ['egypt', 'égypte']],
  ['Afrique du Sud', ['south africa', 'afrique du sud']], ['Kenya', ['kenya']], ['France', ['france']],
  ['Belgique', ['belgium', 'belgique']], ['Pays-Bas', ['netherlands', 'holland', 'pays-bas']], ['Allemagne', ['germany', 'allemagne']],
  ['Italie', ['italy', 'italie']], ['Espagne', ['spain', 'espagne']], ['Royaume-Uni', ['united kingdom', 'uk', 'royaume-uni']],
  ['États-Unis', ['usa', 'united states', 'états-unis']], ['Canada', ['canada']], ['Chine', ['china', 'chine']],
  ['Inde', ['india', 'inde']], ['Turquie', ['turkey', 'türkiye', 'turquie']], ['Émirats', ['uae', 'dubai', 'emirates', 'émirats']],
  ['Arabie saoudite', ['saudi', 'arabie saoudite']], ['Liban', ['lebanon', 'liban']], ['Vietnam', ['vietnam', 'viet nam']],
];
const ACHAT = ['buy', 'buying', 'buyer', 'purchase', 'looking for', 'we need', 'requirement', 'required', 'rfq', 'request for quotation', 'importer', 'achat', 'acheter', 'achète', 'recherche', 'besoin'];
const VENTE = ['sell', 'selling', 'seller', 'for sale', 'we supply', 'we offer', 'supplier of', 'exporter of', 'vend', 'vente', 'propose', 'fournisseur de'];
const VIGILANCE = [
  'western union', 'moneygram', 'registration fee', 'membership fee', 'sample fee', 'processing fee', 'inspection fee',
  'advance payment', 'pay in advance', 'gift card', 'bitcoin', 'crypto', "frais d'inscription", "frais d'échantillon",
  'frais de dossier', "paiement d'avance", 'avance de fonds',
];

return $input.all().map((item) => {
  const m = item.json;
  const sujet = m.subject || m.Subject || '';
  const corps = (m.text || m.snippet || '').replace(/\s+/g, ' ').trim();
  const texte = `${sujet} ${corps}`;
  const expediteur = m.from?.value?.[0]?.address || m.From || '';
  const domaine = (expediteur.split('@')[1] || '').replace(/^(mail|email|info|news|noreply|no-reply)\./, '').replace(/>.*$/, '');

  const achat = ACHAT.some((w) => debutDeMot(w).test(texte));
  const vente = VENTE.some((w) => debutDeMot(w).test(texte));
  const sens = achat && !vente ? 'acheteur' : vente && !achat ? 'vendeur' : 'à vérifier';

  const quantite = (texte.match(/\d[\d.,\s]*\s*(?:mt|metric tons?|tons?|tonnes?|kg|containers?|conteneurs?|fcl|x\s?20|x\s?40|20 ?ft|40 ?ft)\b/i) || [''])[0].trim();
  const emails = [...new Set((corps.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).map((e) => e.replace(/\.+$/, '')))]
    .filter((e) => e !== expediteur)
    .slice(0, 3);
  const telephones = [...new Set(corps.match(/\+\d[\d\s().-]{7,}\d/g) || [])].slice(0, 3);
  const alertes = VIGILANCE.filter((w) => texte.toLowerCase().includes(w));

  return {
    json: {
      date: (m.date || new Date().toISOString()).slice(0, 10),
      source: domaine,
      sens,
      produits: trouver(texte, PRODUITS, debutDeMot).join(', '),
      pays: trouver(texte, PAYS, motEntier).join(', '),
      quantite,
      sujet,
      extrait: corps.slice(0, 400),
      emails: emails.join(', '),
      telephones: telephones.join(', '),
      vigilance: alertes.length ? `ATTENTION : ${alertes.join(', ')}` : '',
      lien_gmail: `https://mail.google.com/mail/u/0/#all/${m.threadId || m.id}`,
      statut: 'nouveau',
      prochaine_action: '',
      notes: '',
      id: m.id,
    },
  };
});
