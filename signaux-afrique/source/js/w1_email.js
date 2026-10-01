// Met en forme l'email du mois : une fiche par opportunité, avec ce qu'il faut retenir et ce que tu peux en faire.
const p = $('Paramètres').first().json;
const lignes = $input.all().map((i) => i.json);
const tous = $('Calculer les scores').all().map((i) => i.json);
const paysAvecDonnees = new Set(tous.map((r) => r.pays));
const paysSansDonnees = p.pays.filter((x) => !paysAvecDonnees.has(x.nom)).map((x) => x.nom);

// Requêtes refusées (quota de la version gratuite) : les chiffres peuvent être incomplets
const echecs = [...$('Comtrade : importations').all(), ...$('Comtrade : qui fournit ?').all()].filter(
  (r) => !Array.isArray(r.json.data),
).length;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const COULEURS = {
  'Projet possible': ['#1f7a4d', '#def0e5'],
  'Possible, avec réserves': ['#9a6410', '#f6ead3'],
  'Courtage maintenant, export plus tard': ['#3346a8', '#e2e6f8'],
  'Courtage seulement': ['#3346a8', '#e2e6f8'],
  'Plus tard (export)': ['#5f6b69', '#e8eceb'],
  'À surveiller': ['#5f6b69', '#e8eceb'],
};

const fiche = (o, i) => {
  const [fg, bg] = COULEURS[o.pour_ma_ferme] || ['#5f6b69', '#e8eceb'];
  return `
  <div style="border:1px solid #e3e8e6;border-radius:10px;padding:12px 14px;margin:0 0 12px">
    <div style="margin:0 0 6px">
      <span style="font-weight:700">${i + 1}. ${esc(o.produit)} → ${esc(o.pays)}</span>
      <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;color:${fg};background:${bg}">${esc(o.pour_ma_ferme)}</span>
      <span style="color:#8a9895;font-size:12px;margin-left:6px">score ${o.score}</span>
    </div>
    <div style="font-size:14px;margin:0 0 6px"><b>À retenir :</b> ${esc(o.a_retenir)}</div>
    <div style="font-size:14px"><b>Que faire :</b> ${esc(o.que_faire)}</div>
  </div>`;
};

const POUR_LA_FERME = ['Projet possible', 'Possible, avec réserves'];
const pourLaFerme = lignes.filter((o) => POUR_LA_FERME.includes(o.pour_ma_ferme));
const autres = lignes.filter((o) => !POUR_LA_FERME.includes(o.pour_ma_ferme));

const html = `
<div style="font-family:Segoe UI,Arial,sans-serif;color:#13201e;max-width:760px">
  <h2 style="margin:0 0 4px">Radar commerce Afrique : ${lignes.length} pistes ce mois-ci</h2>
  <p style="margin:0 0 16px;color:#5a6a67">Pour ta ferme de ${p.ferme.surfaceHa} ha à ${esc(p.ferme.lieu)}, en cycles courts (${p.ferme.cycleMaxMois} mois maximum). Chaque piste dit ce qu'il faut retenir et ce que tu peux en faire. Tableau complet : <a href="${esc(p.googleSheetUrl)}">ta Google Sheet</a>, onglet « Opportunites ».</p>
  ${echecs ? `<p style="background:#fbf0d9;border-radius:8px;padding:10px 12px;margin:0 0 16px;font-size:14px"><b>${echecs} requête(s) ONU Comtrade refusée(s)</b> (quota de la version gratuite, rechargé toutes les 10 minutes). Certains chiffres peuvent manquer : relance le workflow dans 10 minutes.</p>` : ''}
  ${pourLaFerme.length ? `<h3 style="margin:8px 0 10px">Pour ta ferme (${pourLaFerme.length})</h3>${pourLaFerme.map(fiche).join('')}` : ''}
  ${autres.length ? `<h3 style="margin:20px 0 10px">Courtage et export (${autres.length})</h3>${autres.map((o, i) => fiche(o, pourLaFerme.length + i)).join('')}` : ''}
  ${paysSansDonnees.length ? `<p style="font-size:13px;color:#5a6a67;margin-top:16px">Pays sans chiffres récents chez ONU Comtrade (leurs douanes ne publient pas ou en retard) : ${esc(paysSansDonnees.join(', '))}. Pour eux, appuie-toi sur la veille quotidienne et les contacts terrain.</p>` : ''}
  <p style="font-size:12px;color:#8a9895;margin-top:16px">Source : ONU Comtrade (données officielles des douanes, publiées avec 1 à 2 ans de retard). Prix en FCFA au taux de ${p.fcfaParDollar} FCFA pour 1 $. Une piste est à vérifier sur le terrain, ce n'est pas une commande.</p>
</div>`;

const mois = $now.setLocale('fr').toFormat('LLLL yyyy');
return [{ json: { sujet: `Radar commerce Afrique : ${pourLaFerme.length} piste(s) pour ta ferme et ${autres.length} pistes de courtage ou d'export (${mois})`, html } }];
