// =====================================================================
//  PARAMÈTRES DE LA VEILLE QUOTIDIENNE : c'est le seul nœud à modifier.
// =====================================================================

// 1) Où envoyer l'alerte et où ranger les signaux
const email = 'ton.email@exemple.com';
const googleSheetUrl = 'https://docs.google.com/spreadsheets/d/COLLE_ICI_L_ID_DE_TA_FEUILLE/edit';

// 2) Tes projets à la ferme (cycles courts, 5 mois maximum) : les signaux qui en parlent passent en premier.
//    Ajuste les mots-clés quand tu auras choisi tes cultures.
const mesProjets = [
  {
    nom: 'Cultures courtes',
    mots: ['maïs', 'maize', 'tomate', 'tomato', 'piment', 'chili', 'légume', 'vegetable', 'gombo', 'okra',
      'concombre', 'cucumber', 'pastèque', 'watermelon', 'patate douce', 'sweet potato', 'aubergine', 'maraîch'],
  },
  { nom: 'Volaille', mots: ['poulet', 'volaille', 'avicole', 'aviculture', 'poultry', 'chicken', 'œuf', 'oeuf', 'eggs', 'provende'] },
];

// 3) Mots-clés produits, en français ET en anglais. Un signal n'est gardé que s'il en contient au moins un.
//    Écris-les en minuscules, avec les accents. « bean » trouve aussi « beans », « fertili » trouve « fertilizer ».
const motsCles = [
  'maïs', 'maize', 'riz', 'rice', 'manioc', 'cassava', 'gari', 'tapioca', 'cacao', 'cocoa', 'café', 'coffee',
  'poivre', 'pepper', 'piment', 'chili', 'gingembre', 'ginger', 'sésame', 'sesame', 'soja', 'soybean', 'soya',
  'arachide', 'groundnut', 'peanut', 'oignon', 'onion', 'pomme de terre', 'pommes de terre', 'potato', 'haricot',
  'niébé', 'cowpea', 'sorgho', 'sorghum', 'millet', 'huile de palme', 'palm oil', 'banane', 'banana',
  'plantain', 'ananas', 'pineapple', 'avocado', 'mangue', 'mango', 'cajou', 'cashew', 'karité', 'shea',
  'noix de cola', 'kola', 'volaille', 'poulet', 'poultry', 'chicken', 'œuf', 'oeuf', 'egg', 'poisson', 'fish',
  'semence', 'seed', 'engrais', 'fertili', 'provende', 'aliment pour bétail', 'animal feed', 'farine', 'flour',
  'céréale', 'cereal', 'grain', 'vivres', 'denrée', 'foodstuff', 'food supply', 'sucre', 'sugar',
  'tomate', 'tomato', 'légume', 'vegetable', 'gombo', 'okra', 'concombre', 'cucumber', 'pastèque', 'watermelon',
  'patate douce', 'sweet potato', 'aubergine', 'maraîch', 'avicole', 'aviculture',
];

// 4) Mots qui rendent un signal urgent (pénurie, interdiction, flambée des prix…)
const motsAlerte = [
  'pénurie', 'shortage', 'flambée', 'envolée', 'surge', 'spike', 'interdi', 'export ban', 'import ban',
  'suspend', 'rupture', 'crise', 'crisis', 'déficit', 'deficit', "appel d'offres", 'tender',
  'recherche fournisseur', 'seeking supplier', 'looking for supplier',
];

// 5) Une actualité n'est gardée que si elle parle aussi de commerce (évite les articles de cuisine ou de santé)
const motsCommerce = [
  'import', 'export', 'prix', 'price', 'marché', 'market', 'demande', 'demand', 'pénurie', 'shortage', 'cours',
  'filière', 'tonne', 'tons', 'fcfa', 'cfa', 'naira', 'achat', 'buyer', 'supplier', 'fournisseur', 'production',
  'récolte', 'harvest', 'trade', 'commerce', 'tarif', 'douane', 'customs', 'interdi', 'export ban', 'import ban',
  'stock', 'cargaison',
];

// 6) Recherches Google Actualités (même syntaxe que dans Google : OR, guillemets, parenthèses)
const recherchesActualites = [
  { q: 'Cameroun prix (tomate OR piment OR légumes OR maïs OR poulet OR œufs)', langue: 'fr' },
  { q: '(Gabon OR "Guinée équatoriale" OR Congo) Cameroun (tomate OR légumes OR vivres OR maïs)', langue: 'fr' },
  { q: 'Cameroun prix (riz OR oignon OR "huile de palme" OR poisson)', langue: 'fr' },
  { q: 'Cameroun importation (riz OR poisson OR maïs OR "huile de palme" OR blé)', langue: 'fr' },
  { q: '(Gabon OR Congo OR Tchad OR "Guinée équatoriale") importation alimentaire', langue: 'fr' },
  { q: 'interdiction exportation (maïs OR riz OR oignon OR céréales OR bétail)', langue: 'fr' },
  { q: 'Cameroun exportation (cacao OR café OR poivre OR banane OR manioc)', langue: 'fr' },
  { q: 'ZLECAf agriculture', langue: 'fr' },
  { q: 'Nigeria food import (maize OR rice OR onion OR cassava OR poultry)', langue: 'en' },
  { q: 'Africa importers suppliers (cocoa OR cashew OR sesame OR ginger)', langue: 'en' },
  { q: 'Cameroon export (cocoa OR coffee OR pepper OR banana OR cassava)', langue: 'en' },
];
const joursActualites = 7; // articles des 7 derniers jours (ceux déjà vus sont ignorés)

// 7) Pays et régions suivis pour les appels d'offres de la Banque mondiale (noms exacts en anglais)
const paysAppelsOffres = [
  'Cameroon', 'Chad', 'Central African Republic', 'Congo, Republic of', 'Gabon', 'Nigeria',
  'Congo, Democratic Republic of', 'Niger', "Cote d'Ivoire", 'Senegal', 'Ghana', 'Benin', 'Togo', 'Mali',
  'Burkina Faso', 'Guinea', 'Western and Central Africa', 'Central Africa', 'Africa',
];

return [
  {
    json: { email, googleSheetUrl, mesProjets, motsCles, motsAlerte, motsCommerce, recherchesActualites, joursActualites, paysAppelsOffres },
  },
];
