// Fabrique les adresses à interroger chez ONU Comtrade.
// Version sans clé : une seule année par requête, 500 lignes maximum par réponse, et un quota d'appels.
const p = $input.first().json;
const derniereAnnee = new Date().getFullYear() - 1;
const annees = Array.from({ length: p.nbAnnees }, (_, i) => derniereAnnee - i);
const codesPays = p.pays.map((x) => x.code).join(',');

// Autant de produits par requête que possible sans dépasser 500 lignes
const parLot = Math.max(1, Math.floor(450 / p.pays.length));
const lots = [];
for (let i = 0; i < p.produits.length; i += parLot) {
  lots.push(p.produits.slice(i, i + parLot).map((x) => x.hs).join(','));
}

const requetes = [];
for (const annee of annees) {
  for (const codesProduits of lots) {
    const url = `${p.urlComtrade}?reporterCode=${codesPays}&period=${annee}&partnerCode=0&cmdCode=${codesProduits}&flowCode=M`;
    requetes.push({ json: { annee, url: p.cleComtrade ? `${url}&subscription-key=${encodeURIComponent(p.cleComtrade)}` : url } });
  }
}
return requetes;
