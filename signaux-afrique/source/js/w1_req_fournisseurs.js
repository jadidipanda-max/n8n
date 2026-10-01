// Regroupe les opportunités du top par produit et par année : une seule requête Comtrade
// couvre jusqu'à 4 pays, ce qui économise le quota d'appels de la version gratuite.
const p = $('Paramètres').first().json;
const groupes = {};
for (const item of $input.all()) {
  const o = item.json;
  (groupes[`${o.annee}|${o.code_hs}`] ??= []).push(o.code_pays);
}
const requetes = [];
for (const [cle, codesPays] of Object.entries(groupes)) {
  const [annee, hs] = cle.split('|');
  for (let i = 0; i < codesPays.length; i += 4) {
    const url = `${p.urlComtrade}?reporterCode=${codesPays.slice(i, i + 4).join(',')}&period=${annee}&cmdCode=${hs}&flowCode=M`;
    requetes.push({ json: { url: p.cleComtrade ? `${url}&subscription-key=${encodeURIComponent(p.cleComtrade)}` : url } });
  }
}
return requetes;
