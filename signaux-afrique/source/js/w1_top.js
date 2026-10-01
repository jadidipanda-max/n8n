// Choisit les pistes détaillées dans l'email :
// 1) jusqu'à 5 places réservées aux produits que TA ferme peut faire (adaptés à Douala, cycle court,
//    au moins 1 M$ d'importations) ;
// 2) le reste par score, avec au plus 2 pays par produit et 4 marchés hors d'Afrique ;
// les produits sans aucune action possible pour toi (ex. sucre industriel) sont laissés de côté.
const p = $('Paramètres').first().json;
const fiches = Object.fromEntries(p.produits.map((x) => [x.hs, x]));
const pourMoi = (f) => f.faisable && f.faisable !== 'non' && (f.cycleMois ?? 99) <= p.ferme.cycleMaxMois;
const tous = $input.all();

const parProduit = {};
let horsAfrique = 0;
const choisis = new Set();
const prendre = (item) => {
  const o = item.json;
  parProduit[o.code_hs] = (parProduit[o.code_hs] || 0) + 1;
  if (o.zone === 'Hors Afrique') horsAfrique++;
  choisis.add(item);
};
const possible = (item) => {
  const o = item.json;
  const f = fiches[o.code_hs] || {};
  if (choisis.has(item) || (parProduit[o.code_hs] || 0) >= 2) return false;
  if (o.zone === 'Hors Afrique' && horsAfrique >= 4) return false;
  return !(f.faisable === 'non' && !f.zone);
};

// Places réservées : d'abord le marché camerounais (remplacer des importations), puis les voisins africains
const pourLaFerme = tous
  .filter((item) => item.json.zone !== 'Hors Afrique' && item.json.imports_usd >= 1e6 && pourMoi(fiches[item.json.code_hs] || {}))
  .sort((a, b) => (a.json.zone === 'Cameroun' ? 0 : 1) - (b.json.zone === 'Cameroun' ? 0 : 1));
for (const item of pourLaFerme) {
  if (choisis.size >= Math.min(5, p.topN)) break;
  if (possible(item)) prendre(item);
}
for (const item of tous) {
  if (choisis.size >= p.topN) break;
  if (possible(item)) prendre(item);
}
return tous.filter((item) => choisis.has(item));
