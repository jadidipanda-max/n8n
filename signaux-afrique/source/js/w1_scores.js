// Calcule un score de 0 à 100 pour chaque couple pays + produit.
//   35 % taille du marché : 1 M$ d'importations par an = 0, 1 milliard $ = maximum
//   25 % croissance       : −10 %/an = 0, +30 %/an = maximum (sur 3 ans au plus)
//   20 % proximité        : valeur « proximite » du pays dans Paramètres
//   20 % ta position      : « je produis » > « je peux produire » > « je peux sourcer » > surveillance
const p = $('Paramètres').first().json;
const paysParCode = Object.fromEntries(p.pays.map((x) => [String(x.code), x]));
const produitParCode = Object.fromEntries(p.produits.map((x) => [x.hs, x]));
const noteStatut = { 'je produis': 1, 'je peux produire': 0.7, 'je peux sourcer': 0.5 };
const anneeCourante = new Date().getFullYear();
const aujourdhui = $now.toISODate();
const borne = (x, min, max) => Math.min(max, Math.max(min, x));

// 1) Regrouper les chiffres par pays + produit + année
const series = {};
for (const item of $input.all()) {
  const lignes = item.json.data;
  if (!Array.isArray(lignes)) continue; // requête refusée ou vide : on continue avec le reste
  for (const l of lignes) {
    if (l.partnerCode !== 0 || l.flowCode !== 'M' || !l.primaryValue) continue;
    const cle = `${l.reporterCode}-${l.cmdCode}`;
    const s = (series[cle] ??= { codePays: l.reporterCode, hs: l.cmdCode, annees: {} });
    const deja = s.annees[l.refYear];
    if (!deja || l.primaryValue > deja.valeur) {
      s.annees[l.refYear] = { valeur: l.primaryValue, poids: l.netWgt };
    }
  }
}

// 2) Score de chaque série
const resultats = [];
for (const [cle, s] of Object.entries(series)) {
  const pays = paysParCode[String(s.codePays)];
  const produit = produitParCode[s.hs];
  if (!pays || !produit) continue;

  const annees = Object.keys(s.annees).map(Number).sort((a, b) => b - a);
  const derniere = annees[0];
  const valeur = s.annees[derniere].valeur;
  const base = annees.filter((a) => a < derniere && a >= derniere - 3).pop();
  const croissance = base ? Math.pow(valeur / s.annees[base].valeur, 1 / (derniere - base)) - 1 : null;
  const poids = s.annees[derniere].poids;

  const noteTaille = borne((Math.log10(valeur) - 6) / 3, 0, 1);
  const noteCroissance = croissance === null ? 0.4 : borne((croissance + 0.1) / 0.4, 0, 1);
  const noteProximite = borne(Number(pays.proximite) || 0, 0, 1);
  const notePosition = noteStatut[produit.statut] ?? 0.2;
  const score = Math.round(
    100 * (0.35 * noteTaille + 0.25 * noteCroissance + 0.2 * noteProximite + 0.2 * notePosition),
  );

  let typeSignal = 'Exporter ou faire du courtage en Afrique';
  if (pays.zone === 'Cameroun') typeSignal = 'Remplacer des importations au Cameroun';
  if (pays.zone === 'Hors Afrique') typeSignal = "Exporter hors d'Afrique";

  resultats.push({
    cle,
    score,
    type_signal: typeSignal,
    pays: pays.nom,
    zone: pays.zone,
    produit: produit.nom,
    code_hs: s.hs,
    mon_statut: produit.statut || '',
    annee: derniere,
    imports_usd: Math.round(valeur),
    croissance_annuelle_pct: croissance === null ? '' : Math.round(croissance * 1000) / 10,
    prix_usd_kg: poids > 0 ? Math.round((valeur / poids) * 100) / 100 : '',
    donnees_anciennes: derniere < anneeCourante - 3 ? 'oui' : 'non',
    code_pays: s.codePays,
    date_maj: aujourdhui,
  });
}

if (!resultats.length) {
  throw new Error("Aucune donnée reçue d'ONU Comtrade (limite de requêtes atteinte ?). Relance dans quelques minutes.");
}
resultats.sort((a, b) => b.score - a.score);
return resultats.map((json) => ({ json }));
