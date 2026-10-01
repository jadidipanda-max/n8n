// Une adresse de flux RSS Google Actualités par recherche
const p = $input.first().json;
const LANGUES = { fr: 'hl=fr&gl=FR&ceid=FR:fr', en: 'hl=en-US&gl=US&ceid=US:en' };
return p.recherchesActualites.map((r) => ({
  json: {
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${r.q} when:${p.joursActualites}d`)}&${LANGUES[r.langue] || LANGUES.fr}`,
  },
}));
