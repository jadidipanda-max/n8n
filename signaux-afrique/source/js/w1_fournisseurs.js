// Pour chaque opportunité du top : qui vend aujourd'hui à ce pays, quelle part vient d'Afrique et du Cameroun,
// puis le brief : ce qu'il faut retenir et ce que tu peux en faire avec ta ferme.
const top = $('Top N').all();
const lignesFournisseurs = $('Comtrade : qui fournit ?')
  .all()
  .flatMap((r) => (Array.isArray(r.json.data) ? r.json.data : []));
const noms = {};
for (const r of $input.first().json.results || []) noms[String(r.id)] = r.text;

// Codes ONU des pays africains
const AFRIQUE = new Set([
  12, 24, 72, 108, 120, 132, 140, 148, 174, 178, 180, 204, 226, 231, 232, 262, 266, 270, 288, 324, 384,
  404, 426, 430, 434, 450, 454, 466, 478, 480, 504, 508, 516, 562, 566, 624, 646, 654, 678, 686, 690,
  694, 706, 710, 711, 716, 728, 729, 732, 748, 768, 788, 800, 818, 834, 854, 894,
]);
const CAMEROUN = 120;

const pct = (x) => Math.round(x * 1000) / 10;
const virgule = (x) => String(x).replace('.', ',');
const montant = (v) =>
  v >= 1e9 ? `${virgule((v / 1e9).toFixed(2))} Md$` : v >= 1e6 ? `${virgule((v / 1e6).toFixed(1))} M$` : `${Math.round(v / 1e3)} k$`;

// ---------- Brief : ce qu'il faut retenir et ce que tu peux en faire ----------
const p = $('Paramètres').first().json;
const fiches = Object.fromEntries(p.produits.map((x) => [x.hs, x]));
const paysParCode = Object.fromEntries(p.pays.map((x) => [x.code, x]));
const fcfa = (usd) => Math.round((usd * p.fcfaParDollar) / 5) * 5;
const de = (x) => (/^([aeiouyœéèêàâîôû]|huile)/i.test(x) ? `d'${x}` : `de ${x}`);

function aRetenir(o, total) {
  const tendance =
    o.croissance_annuelle_pct === ''
      ? ''
      : `, ${o.croissance_annuelle_pct >= 0 ? 'en hausse' : 'en baisse'} de ${virgule(Math.abs(o.croissance_annuelle_pct))} % par an`;
  let t = `${o.pays} : ${montant(o.imports_usd)} d'importations ${de(o.produit.toLowerCase())} en ${o.annee}${tendance}.`;
  if (o.prix_usd_kg !== '') t += ` Prix moyen à l'arrivée : ${virgule(o.prix_usd_kg)} $/kg, soit environ ${fcfa(o.prix_usd_kg)} FCFA/kg avant droits de douane et marges.`;
  if (total) {
    if (o.code_pays === CAMEROUN) {
      t += ` ${virgule(pct(1 - o.part_afrique_pct / 100))} % vient de l'extérieur de l'Afrique (${o.principaux_fournisseurs}).`;
    } else {
      t += ` Fournisseurs : ${o.principaux_fournisseurs}. L'Afrique fournit ${virgule(o.part_afrique_pct)} %, le Cameroun ${virgule(o.part_cameroun_pct)} %.`;
    }
  }
  if (o.donnees_anciennes === 'oui') t += ` Chiffres de ${o.annee} : à confirmer sur le terrain.`;
  return t;
}

// Un produit est « pour toi » s'il est adapté à Douala ET si son cycle respecte ta limite (ferme.cycleMaxMois)
const cycleOk = (f) => (f.cycleMois ?? 99) <= p.ferme.cycleMaxMois;
const tropLong = (f) => `cycle trop long pour toi (${f.delai}, au-delà de ${p.ferme.cycleMaxMois} mois)`;

function queFaire(o) {
  const f = fiches[o.code_hs] || { faisable: 'non' };
  const dans = paysParCode[o.code_pays]?.dans || `en ${o.pays}`;
  const pourMoi = f.faisable !== 'non' && cycleOk(f);
  const raison = f.faisable === 'non' ? f.note : !cycleOk(f) ? tropLong(f) : f.note;

  if (o.zone === 'Cameroun') {
    if (pourMoi && f.faisable === 'oui') {
      return {
        pour_ma_ferme: 'Projet possible',
        que_faire: `Tu peux remplacer une partie de ces importations depuis ta ferme : ${f.projet}. Premières ventes : ${f.delai}. Le produit importé arrive autour de ${o.prix_usd_kg !== '' ? fcfa(o.prix_usd_kg) + ' FCFA/kg' : 'un prix à vérifier'} : c'est le prix de ta concurrence avant droits et marges. Prochaine étape : ${f.etape}.`,
      };
    }
    if (pourMoi) {
      return {
        pour_ma_ferme: 'Possible, avec réserves',
        que_faire: `Faisable à ${p.ferme.lieu} mais pas idéal : ${f.note}. Projet possible : ${f.projet} (premières ventes : ${f.delai}). Autre piste : apporteur d'affaires entre les producteurs ${f.zone} et les grossistes de Douala.`,
      };
    }
    if (!f.zone) {
      return { pour_ma_ferme: 'À surveiller', que_faire: `Pas pour ta ferme : ${raison}. Rien à faire pour l'instant.` };
    }
    return {
      pour_ma_ferme: 'Courtage seulement',
      que_faire: `Pas pour ta ferme : ${raison}. Piste d'apporteur d'affaires : les grossistes de Douala achètent à l'étranger ; propose-leur des producteurs ${f.zone}, avec ta commission fixée par écrit.`,
    };
  }
  if (o.zone === 'Hors Afrique') {
    return {
      pour_ma_ferme: 'Plus tard (export)',
      que_faire: `Gros marché mais exigeant (normes, certificats${['1801', '0901'].includes(o.code_hs) ? ', traçabilité anti-déforestation pour l’Union européenne' : ''}). Pas pour démarrer. Pour l'instant : apporteur d'affaires auprès d'exportateurs agréés du Cameroun${pourMoi ? `, et débouché possible plus tard pour ton projet « ${f.projet} »` : ''}.`,
    };
  }
  // Afrique et CEMAC
  let accroche = '';
  if (o.part_afrique_pct !== '' && o.part_afrique_pct < 20) {
    accroche = `Ce pays achète presque tout hors d'Afrique : un fournisseur camerounais a un argument (proximité, ${o.zone === 'CEMAC' ? 'pas de droits de douane dans la CEMAC' : 'ZLECAf'}). `;
  } else if (o.part_afrique_pct !== '') {
    accroche = `Des fournisseurs africains sont déjà présents : il faudra être compétitif sur le prix. `;
  }
  if (pourMoi && f.faisable === 'oui') {
    return {
      pour_ma_ferme: 'Courtage maintenant, export plus tard',
      que_faire: `${accroche}Tout de suite : apporteur d'affaires entre des producteurs camerounais et des importateurs ${dans} (chambre de commerce, ambassade, plateformes B2B). Plus tard : débouché pour ton projet « ${f.projet} », une fois le marché de Douala maîtrisé.`,
    };
  }
  return {
    pour_ma_ferme: 'Courtage seulement',
    que_faire: `${accroche}Pas pour ta ferme (${raison || 'pas adapté à Douala'}), mais piste d'apporteur d'affaires : producteurs ${f.zone || 'camerounais'} vers des importateurs ${dans}.`,
  };
}

return top.map((item) => {
  const o = { ...item.json };
  const lignes = lignesFournisseurs.filter(
    (l) => l.reporterCode === o.code_pays && l.cmdCode === o.code_hs && l.refYear === o.annee,
  );

  // Une ligne par fournisseur (on garde la plus grosse si doublon)
  const parFournisseur = {};
  for (const l of lignes) {
    if (l.partnerCode === 0 || l.flowCode !== 'M' || !l.primaryValue) continue;
    const deja = parFournisseur[l.partnerCode];
    if (!deja || l.primaryValue > deja.primaryValue) parFournisseur[l.partnerCode] = l;
  }
  const liste = Object.values(parFournisseur).sort((a, b) => b.primaryValue - a.primaryValue);
  const total = liste.reduce((a, l) => a + l.primaryValue, 0);

  if (!total) {
    o.part_afrique_pct = '';
    o.part_cameroun_pct = '';
    o.principaux_fournisseurs = 'non disponible';
  } else {
    const afrique = liste
      .filter((l) => AFRIQUE.has(l.partnerCode) && l.partnerCode !== o.code_pays)
      .reduce((a, l) => a + l.primaryValue, 0);
    const cameroun = parFournisseur[CAMEROUN]?.primaryValue || 0;
    o.part_afrique_pct = pct(afrique / total);
    o.part_cameroun_pct = o.code_pays === CAMEROUN ? '' : pct(cameroun / total);
    o.principaux_fournisseurs = liste
      .slice(0, 3)
      .map((l) => `${noms[String(l.partnerCode)] || 'Pays ' + l.partnerCode} ${Math.round((100 * l.primaryValue) / total)} %`)
      .join(', ');

    // Prix moyen au kilo, si la ligne « monde » ne le donnait pas
    if (o.prix_usd_kg === '') {
      const avecPoids = liste.filter((l) => l.netWgt > 0);
      const poids = avecPoids.reduce((a, l) => a + l.netWgt, 0);
      if (poids) o.prix_usd_kg = Math.round((avecPoids.reduce((a, l) => a + l.primaryValue, 0) / poids) * 100) / 100;
    }
  }

  o.a_retenir = aRetenir(o, total);
  Object.assign(o, queFaire(o));
  return { json: o };
});
