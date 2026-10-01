// Met les articles au format commun des signaux
const sorties = [];
for (const item of $input.all()) {
  const a = item.json;
  if (!a.link || !a.title) continue;
  // Google Actualités ajoute « - Nom du journal » à la fin du titre : on le retire
  const coupe = a.title.lastIndexOf(' - ');
  const titre = (coupe > 0 ? a.title.slice(0, coupe) : a.title).replace(/\s*-\s*$/, '');
  const journal = coupe > 0 ? a.title.slice(coupe + 3) : '';
  sorties.push({
    json: {
      id: `actu:${a.guid || a.link}`,
      type: 'Actualité',
      source: journal ? `Google Actualités (${journal})` : 'Google Actualités',
      date: (a.isoDate || '').slice(0, 10),
      pays: '',
      titre,
      lien: a.link,
      acheteur: '',
      contact: '',
      date_limite: '',
      texte: titre,
    },
  });
}
return sorties;
