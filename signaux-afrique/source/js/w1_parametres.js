// =====================================================================
//  PARAMÈTRES DU RADAR : c'est le seul nœud à modifier.
//  Source : ONU Comtrade (importations déclarées par les douanes de chaque pays).
// =====================================================================

// 1) Où envoyer le résumé et où ranger les résultats
const email = 'ton.email@exemple.com';
const googleSheetUrl = 'https://docs.google.com/spreadsheets/d/COLLE_ICI_L_ID_DE_TA_FEUILLE/edit';

// 2) Ta ferme : sert à écrire le brief de chaque signal (« à retenir » et « que faire »).
//    Règle : uniquement des cycles courts. Un produit dont le cycle dépasse cycleMaxMois
//    n'est jamais proposé comme projet pour la ferme, seulement en courtage.
const ferme = {
  lieu: 'Douala',
  surfaceHa: 18,
  cycleMaxMois: 5, // 4 à 5 mois maximum avant la première vente
  demarrage: 'décembre 2026',
};
const fcfaParDollar = 578; // taux du 30/09/2026 (1 € = 655,957 FCFA) : à mettre à jour de temps en temps

// 3) Tes produits (code douanier SH à 4 ou 6 chiffres), avec ce qu'ils représentent pour ta ferme à Douala.
//    statut    : 'je produis' | 'je peux produire' | 'je peux sourcer' | '' (simple surveillance)
//    faisable  : 'oui' | 'moyen' | 'non' : est-ce adapté au climat de Douala ?
//    cycleMois : mois avant la première vente (comparé à ferme.cycleMaxMois)
//    projet    : le projet concret ; delai : en clair ; etape : la prochaine action
//    zone      : d'où viennent les producteurs quand ce n'est pas pour toi (« du Nord »…), pour le courtage
const produits = [
  // --- Cycles courts adaptés à Douala : ce que tu peux produire ---
  { hs: '0702', nom: 'Tomates', statut: 'je peux produire', faisable: 'oui', cycleMois: 3, projet: 'tomates (de préférence en saison sèche, avec irrigation)', delai: '3 mois', etape: "choisir des variétés résistantes à la chaleur et aux maladies, et prévoir l'irrigation pour la saison sèche (décembre à février)" },
  { hs: '0709', nom: 'Autres légumes frais (piment, gombo, aubergine…)', statut: 'je peux produire', faisable: 'oui', cycleMois: 3, projet: 'légumes (piment, gombo, aubergine, poivron)', delai: '2 à 3 mois', etape: 'repérer les grossistes et revendeuses des marchés de Douala (Sandaga…) et leurs prix selon la saison' },
  { hs: '0707', nom: 'Concombres', statut: 'je peux produire', faisable: 'oui', cycleMois: 2.5, projet: 'concombres', delai: '2 à 3 mois', etape: 'trouver 2 ou 3 acheteurs réguliers (supermarchés, restaurants, revendeuses)' },
  { hs: '0807', nom: 'Pastèques et melons', statut: 'je peux produire', faisable: 'oui', cycleMois: 3, projet: 'pastèques (saison sèche)', delai: '3 mois', etape: "planter en début de saison sèche et prévoir l'irrigation" },
  { hs: '0904', nom: 'Piment et poivre séchés', statut: 'je peux produire', faisable: 'oui', cycleMois: 4, projet: 'piment (frais ou séché)', delai: '3 à 4 mois', etape: 'tester le séchage du piment, qui se garde et se vend loin (Gabon, Nigeria)' },
  { hs: '0714', nom: 'Patates douces, manioc et tubercules', statut: 'je peux produire', faisable: 'oui', cycleMois: 4, projet: 'patate douce (le manioc, 9 à 12 mois, est trop long pour toi)', delai: '3 à 5 mois', etape: "trouver des boutures de variétés améliorées (IRAD) et des acheteurs avant de planter" },
  { hs: '1005', nom: 'Maïs', statut: 'je peux produire', faisable: 'moyen', cycleMois: 3.5, projet: 'maïs (frais en épis, ou en grain pour la provende)', delai: '3 à 4 mois', note: "l'humidité de Douala complique le séchage et le stockage du grain ; le maïs frais en épis se vend sans séchage", zone: "de l'Ouest et du Nord" },
  { hs: '0207', nom: 'Viande de volaille', statut: 'je peux produire', faisable: 'oui', cycleMois: 1.5, projet: 'poulets de chair en bâtiment (moins de 0,5 ha)', delai: '45 jours par bande', etape: 'chiffrer une bande de 500 poulets : poussins de couvoir agréé, aliment, vaccins, puis trouver 2 ou 3 acheteurs (restaurants, revendeuses) avant de démarrer' },
  { hs: '0407', nom: 'Œufs', statut: 'je peux produire', faisable: 'oui', cycleMois: 5, projet: 'poules pondeuses en bâtiment', delai: '5 mois (début de ponte), puis des œufs chaque jour pendant environ un an', etape: 'chiffrer un lot de 1 000 pondeuses et repérer les boulangeries et supermarchés acheteurs' },
  { hs: '230990', nom: 'Provende (aliments pour volaille)', statut: '', faisable: 'oui', cycleMois: 1, projet: "fabriquer l'aliment de tes propres poulets (maïs, soja, tourteaux)", delai: '1 à 2 mois', etape: "à envisager seulement après avoir lancé les poulets, pour baisser ton premier poste de coût" },
  { hs: '1106', nom: 'Farines de manioc et gari', statut: '', faisable: 'oui', cycleMois: 1, projet: 'petite unité de gari en achetant le manioc', delai: 'quelques semaines', etape: 'chiffrer une râpeuse, une presse et un torréfacteur, et tester la vente de gari à Douala' },
  { hs: '1006', nom: 'Riz', statut: '', faisable: 'moyen', cycleMois: 4.5, projet: 'riz de bas-fonds avec décortiqueuse', delai: '4 à 5 mois', note: 'le riz importé arrive très bon marché ; il faut de la mécanisation pour rivaliser', zone: 'du Nord et du Nord-Ouest (Ndop)' },
  { hs: '1202', nom: 'Arachides', statut: '', faisable: 'moyen', cycleMois: 3.5, projet: 'arachide', delai: '3 à 4 mois', note: 'pousse mieux en savane, mais possible sur sol sableux', zone: 'du Nord et du Centre' },
  { hs: '1201', nom: 'Soja', statut: '', faisable: 'moyen', cycleMois: 4, projet: 'soja (pour la provende)', delai: '4 mois', note: 'mieux adapté aux savanes', zone: "de l'Adamaoua et du Nord" },
  { hs: '0713', nom: 'Haricots et niébé secs', statut: '', faisable: 'moyen', cycleMois: 3, projet: 'niébé ou haricot', delai: '2 à 3 mois', note: "l'humidité favorise les maladies", zone: "de l'Ouest et du Nord" },
  // --- Cycles trop longs pour toi (plus de 5 mois) : courtage seulement ---
  { hs: '0303', nom: 'Poisson congelé', statut: '', faisable: 'oui', cycleMois: 7, projet: 'pisciculture (silure, tilapia)', delai: '6 à 8 mois', zone: 'des fermes piscicoles du Littoral et du Centre' },
  { hs: '0803', nom: 'Bananes et plantains', statut: '', faisable: 'oui', cycleMois: 12, projet: 'plantain', delai: '10 à 14 mois', zone: 'du Moungo et du Littoral' },
  { hs: '0910', nom: 'Gingembre, curcuma et épices', statut: '', faisable: 'oui', cycleMois: 9, projet: 'gingembre', delai: '8 à 10 mois', zone: 'de tout le pays' },
  { hs: '0804', nom: 'Ananas, avocats, mangues', statut: '', faisable: 'oui', cycleMois: 15, projet: 'ananas', delai: '14 à 18 mois', zone: 'du Littoral et du Centre' },
  { hs: '1511', nom: 'Huile de palme', statut: '', faisable: 'oui', cycleMois: 36, projet: 'palmeraie', delai: '3 ans', zone: 'des huileries et planteurs du Littoral et du Sud-Ouest' },
  { hs: '1801', nom: 'Fèves de cacao', statut: '', faisable: 'moyen', cycleMois: 48, projet: 'cacaoyère', delai: '3 à 5 ans', note: 'la traçabilité est exigée pour l’Union européenne', zone: 'du Centre, du Sud et du Sud-Ouest' },
  { hs: '0901', nom: 'Café', statut: '', faisable: 'moyen', cycleMois: 36, projet: 'caféier robusta', delai: '3 ans', zone: 'du Moungo et de l’Ouest' },
  { hs: '1108', nom: 'Amidons (dont amidon de manioc)', statut: '', faisable: 'moyen', cycleMois: 12, projet: 'amidon de manioc', delai: '1 an', note: 'demande un procédé industriel', zone: 'des bassins de manioc du Centre et de l’Est' },
  // --- Pas adaptés à Douala ---
  { hs: '0703', nom: 'Oignons, ail, échalotes', statut: '', faisable: 'non', cycleMois: 4, note: 'trop humide à Douala', zone: 'du Nord et de l’Extrême-Nord' },
  { hs: '0701', nom: 'Pommes de terre', statut: '', faisable: 'non', cycleMois: 4, note: "il faut l'altitude", zone: "de l'Ouest et du Nord-Ouest" },
  { hs: '0801', nom: 'Noix de cajou et noix de coco', statut: '', faisable: 'non', cycleMois: 48, note: 'le cajou pousse dans le Nord, et le cocotier met des années', zone: 'du Nord' },
  { hs: '1207', nom: 'Sésame, karité et autres graines', statut: '', faisable: 'non', cycleMois: 4, note: 'cultures de savane', zone: 'du Nord et de l’Extrême-Nord' },
  { hs: '1701', nom: 'Sucre', statut: '', faisable: 'non', cycleMois: 12, note: "c'est une industrie (canne à sucre à très grande échelle)", zone: '' },
];

// 4) Les marchés à surveiller (code pays de l'ONU). « dans » sert à écrire les briefs (« au Congo », « aux Pays-Bas »…).
//    proximite : 1 = très facile d'accès (route, zone CEMAC) … 0.3 = loin ou normes exigeantes
const pays = [
  { code: 120, nom: 'Cameroun', dans: 'au Cameroun', zone: 'Cameroun', proximite: 1 },
  { code: 266, nom: 'Gabon', dans: 'au Gabon', zone: 'CEMAC', proximite: 0.9 },
  { code: 178, nom: 'Congo', dans: 'au Congo', zone: 'CEMAC', proximite: 0.9 },
  { code: 226, nom: 'Guinée équatoriale', dans: 'en Guinée équatoriale', zone: 'CEMAC', proximite: 0.9 },
  { code: 148, nom: 'Tchad', dans: 'au Tchad', zone: 'CEMAC', proximite: 0.9 },
  { code: 140, nom: 'Centrafrique', dans: 'en Centrafrique', zone: 'CEMAC', proximite: 0.8 },
  { code: 566, nom: 'Nigeria', dans: 'au Nigeria', zone: 'Afrique', proximite: 0.8 },
  { code: 180, nom: 'RD Congo', dans: 'en RD Congo', zone: 'Afrique', proximite: 0.6 },
  { code: 562, nom: 'Niger', dans: 'au Niger', zone: 'Afrique', proximite: 0.6 },
  { code: 204, nom: 'Bénin', dans: 'au Bénin', zone: 'Afrique', proximite: 0.6 },
  { code: 768, nom: 'Togo', dans: 'au Togo', zone: 'Afrique', proximite: 0.5 },
  { code: 288, nom: 'Ghana', dans: 'au Ghana', zone: 'Afrique', proximite: 0.5 },
  { code: 384, nom: "Côte d'Ivoire", dans: "en Côte d'Ivoire", zone: 'Afrique', proximite: 0.5 },
  { code: 686, nom: 'Sénégal', dans: 'au Sénégal', zone: 'Afrique', proximite: 0.5 },
  { code: 504, nom: 'Maroc', dans: 'au Maroc', zone: 'Afrique', proximite: 0.4 },
  { code: 12, nom: 'Algérie', dans: 'en Algérie', zone: 'Afrique', proximite: 0.4 },
  { code: 251, nom: 'France', dans: 'en France', zone: 'Hors Afrique', proximite: 0.3 },
  { code: 56, nom: 'Belgique', dans: 'en Belgique', zone: 'Hors Afrique', proximite: 0.3 },
  { code: 528, nom: 'Pays-Bas', dans: 'aux Pays-Bas', zone: 'Hors Afrique', proximite: 0.3 },
  { code: 276, nom: 'Allemagne', dans: 'en Allemagne', zone: 'Hors Afrique', proximite: 0.3 },
  { code: 380, nom: 'Italie', dans: 'en Italie', zone: 'Hors Afrique', proximite: 0.3 },
  { code: 826, nom: 'Royaume-Uni', dans: 'au Royaume-Uni', zone: 'Hors Afrique', proximite: 0.3 },
  { code: 842, nom: 'États-Unis', dans: 'aux États-Unis', zone: 'Hors Afrique', proximite: 0.3 },
  { code: 156, nom: 'Chine', dans: 'en Chine', zone: 'Hors Afrique', proximite: 0.3 },
  { code: 784, nom: 'Émirats arabes unis', dans: 'aux Émirats arabes unis', zone: 'Hors Afrique', proximite: 0.3 },
];

// 5) Réglages
const nbAnnees = 5; // années d'historique demandées (la plus récente = l'an dernier)
const topN = 15; // nombre d'opportunités détaillées dans l'email (2 pays maximum par produit)

// 6) Facultatif : clé gratuite ONU Comtrade (comtradedeveloper.un.org) pour dépasser le quota de la version sans clé.
//    Laisse '' si tu n'en as pas.
const cleComtrade = '';
const urlComtrade = cleComtrade
  ? 'https://comtradeapi.un.org/data/v1/get/C/A/HS'
  : 'https://comtradeapi.un.org/public/v1/preview/C/A/HS';

return [
  { json: { email, googleSheetUrl, ferme, fcfaParDollar, produits, pays, nbAnnees, topN, cleComtrade, urlComtrade } },
];
