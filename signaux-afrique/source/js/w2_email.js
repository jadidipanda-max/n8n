// Met en forme l'alerte du jour : une fiche par signal avec ce qu'il faut retenir et ce que tu peux en faire.
// (Les 30 premiers signaux ; tout est dans la Google Sheet.)
const p = $('Paramètres').first().json;
const signaux = $input.all().map((i) => i.json);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fiche = (s) => `
  <div style="border:1px solid #e3e8e6;border-radius:10px;padding:12px 14px;margin:0 0 10px">
    <div style="margin:0 0 6px;font-size:13px;color:#5a6a67">
      ${s.priorite === 'haute' ? '<b style="color:#b03434">● urgent</b> · ' : ''}${esc(s.type)}${s.pays ? ' · ' + esc(s.pays) : ''}${s.date_limite ? ' · date limite ' + esc(s.date_limite) : ''}
      ${s.concerne_projet ? `<span style="display:inline-block;margin-left:4px;padding:1px 8px;border-radius:999px;font-weight:600;color:#1f7a4d;background:#def0e5">${esc(s.concerne_projet)}</span>` : ''}
    </div>
    <div style="font-size:14px;margin:0 0 6px"><b>À retenir :</b> ${esc(s.a_retenir)} <a href="${esc(s.lien)}">Lire</a></div>
    <div style="font-size:14px"><b>Que faire :</b> ${esc(s.que_faire)}</div>
  </div>`;

const groupes = [
  ['Touche tes projets', signaux.filter((s) => s.concerne_projet)],
  ["Appels d'offres", signaux.filter((s) => !s.concerne_projet && s.type === "Appel d'offres")],
  ['Actualités', signaux.filter((s) => !s.concerne_projet && s.type !== "Appel d'offres")],
];
let reste = 30;
const blocs = groupes
  .filter(([, liste]) => liste.length)
  .map(([titre, liste]) => {
    const montres = liste.slice(0, Math.max(0, reste));
    reste -= montres.length;
    return montres.length ? `<h3 style="margin:18px 0 8px">${titre} (${liste.length})</h3>${montres.map(fiche).join('')}` : '';
  })
  .join('');

const nbAo = signaux.filter((s) => s.type === "Appel d'offres").length;
const nbProjets = signaux.filter((s) => s.concerne_projet).length;
const html = `
<div style="font-family:Segoe UI,Arial,sans-serif;color:#13201e;max-width:760px">
  <h2 style="margin:0 0 4px">Veille Afrique : ${signaux.length} nouveaux signaux</h2>
  <p style="margin:0 0 8px;color:#5a6a67">Tout est rangé dans <a href="${esc(p.googleSheetUrl)}">ta Google Sheet</a>, onglet « Signaux ». Mets à jour la colonne « statut » quand tu as contacté quelqu'un.</p>
  ${blocs}
</div>`;

const details = [nbProjets && `${nbProjets} sur tes projets`, nbAo && `${nbAo} appel(s) d'offres`].filter(Boolean).join(', ');
return [{ json: { sujet: `Veille Afrique : ${signaux.length} nouveaux signaux${details ? ` (${details})` : ''}`, html } }];
