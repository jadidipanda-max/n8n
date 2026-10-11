# Registre : nombre d'établissements, siège, catégorie, chiffre d'affaires, pour chaque lead rapproché.
import json, time, requests, os
L = json.load(open('leads_pest.json'))
S = requests.Session()
out = json.load(open('reg_check.json')) if os.path.exists('reg_check.json') else {}
def api(q):
    for i in range(6):
        try:
            r = S.get('https://recherche-entreprises.api.gouv.fr/search', params={'q': q, 'per_page': 5}, timeout=25)
            if r.status_code == 429: time.sleep(3 + 3 * i); continue
            if r.status_code == 200: time.sleep(0.6); return r.json().get('results', [])
        except Exception: time.sleep(2 + i)
    return None
for n, l in enumerate(L):
    s = l.get('siren')
    if not s or s in out: continue
    res = api(s) or []
    r = next((x for x in res if x.get('siren') == s), None)
    if not r: out[s] = None; continue
    sg = r.get('siege') or {}
    fin = r.get('finances') or {}
    yr = max(fin) if fin else None
    out[s] = {'etab': r.get('nombre_etablissements_ouverts'), 'cat': r.get('categorie_entreprise'), 'nature': r.get('nature_juridique'),
              'siegeDep': sg.get('departement'), 'siegeCp': sg.get('code_postal'), 'siegeVille': sg.get('libelle_commune'),
              'eff': r.get('tranche_effectif_salarie'), 'ca': (fin.get(yr) or {}).get('ca') if yr else None, 'caAn': yr,
              'nom': r.get('nom_complet'), 'ape': r.get('activite_principale'), 'creation': r.get('date_creation'),
              'nbDir': len(r.get('dirigeants') or []), 'dirMorale': [d.get('denomination') for d in (r.get('dirigeants') or []) if d.get('type_dirigeant') == 'personne morale']}
    if n % 40 == 0:
        json.dump(out, open('reg_check.json', 'w'), ensure_ascii=False); print(n, len(out), flush=True)
json.dump(out, open('reg_check.json', 'w'), ensure_ascii=False)
print('fin', len(out), flush=True)
