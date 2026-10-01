// Met les appels d'offres de la Banque mondiale au format commun des signaux.
// On ne garde que ceux dont la date limite n'est pas dépassée.
const MOIS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const enIso = (d) => {
  const m = /^(\d{2})-(\w{3})-(\d{4})$/.exec(d || '');
  return m ? `${m[3]}-${MOIS[m[2]] || '01'}-${m[1]}` : '';
};
const aujourdhui = $now.toISODate();

const sorties = [];
for (const n of $input.first().json.procnotices || []) {
  const dateLimite = (n.submission_deadline_date || '').slice(0, 10);
  if (dateLimite && dateLimite < aujourdhui) continue;
  sorties.push({
    json: {
      id: `bm:${n.id}`,
      type: "Appel d'offres",
      source: 'Banque mondiale',
      date: enIso(n.noticedate),
      pays: n.project_ctry_name || '',
      titre: n.bid_description || n.project_name || '',
      lien: `https://projects.worldbank.org/en/projects-operations/procurement-detail/${n.id}`,
      acheteur: n.contact_organization || '',
      contact: [n.contact_name, n.contact_email, n.contact_phone_no].filter(Boolean).join(' · '),
      date_limite: dateLimite,
      texte: n.bid_description || '',
    },
  });
}
return sorties;
