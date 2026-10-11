# Exclusions décidées après relecture de a_relire.json (phrase exacte du site, registre), puis lots de 50.
import json, os, re, collections as C
from urllib.parse import urlparse

L = json.load(open('leads_cvc_brut.json'))
def dom(u): return urlparse(u if '//' in (u or '') else 'http://' + (u or '')).netloc.lower().replace('www.', '')
EXCL = json.load(open('exclusions.json'))  # [[motif sur nom + site, raison], …]
REGC = json.load(open('reg_cache.json'))
SOLO = 'Entrepreneur individuel sans salarié déclaré : probablement seul (ICP : au moins 2 techniciens)'

keep, out = [], []
for l in L:
    key = (l['annonceur'] or '') + ' ' + dom(l.get('site'))
    why = next((w for p, w in EXCL if re.search(p, key, re.I)), None)
    r = (REGC.get(l['id'][1:]) or [None])[0] or {}
    if not why and r.get('nature_juridique') == '1000' and r.get('tranche_effectif_salarie') in (None, 'NN', '00'): why = SOLO
    if why: out.append((l['annonceur'], l['ville'], why)); continue
    # Priorités : P1 = taille confirmée au registre (3 à 19 salariés) et portable ; P2 = portable, taille à confirmer ; P3 = ligne fixe
    taille = l.get('effectif') in ('3-5 salariés', '6-9 salariés', '10-19 salariés')
    l['zone'] = 'P1' if taille and l['mobile'] else 'P2' if l['mobile'] else 'P3'
    keep.append(l)
keep.sort(key=lambda l: (l['zone'], -l['score'], 0 if l['dirigeant'] else 1, -(l['avis'] or 0)))
for i, l in enumerate(keep, 1): l['ordre'] = i
json.dump(keep, open('leads_cvc.json', 'w'), ensure_ascii=False)
json.dump(out, open('exclus_verif.json', 'w'), ensure_ascii=False, indent=0)
os.makedirs('lots', exist_ok=True)
for f in os.listdir('lots'): os.remove(os.path.join('lots', f))
for i in range(0, len(keep), 50):
    json.dump({'leads': keep[i:i + 50]}, open('lots/lot%02d.json' % (i // 50 + 1), 'w'), ensure_ascii=False)
print('exclus', len(out), '· gardés', len(keep), '· lots', (len(keep) + 49) // 50)
for w, n in C.Counter(w for _, _, w in out).most_common(): print(f'  {n:2} {w}')
print('priorités', dict(C.Counter(l['zone'] for l in keep)), '· portables', sum(l['mobile'] for l in keep), '(dont site', sum(1 for l in keep if l.get('telGoogle')), ')',
      '· noms', dict(C.Counter(l.get('nomFiab') for l in keep)), '· tailles', dict(C.Counter(l.get('effectif') for l in keep)))
