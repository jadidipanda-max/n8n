import json, re, sys, glob, os
from datetime import date, datetime

TODAY = date(2026, 10, 12)
MONTHS = {'jan':1,'janv':1,'fev':2,'fév':2,'fevr':2,'févr':2,'mar':3,'mars':3,'avr':4,'mai':5,
          'jui':6,'juin':6,'juil':7,'jul':7,'aou':8,'aoû':8,'août':8,'sep':9,'sept':9,
          'oct':10,'nov':11,'dec':12,'déc':12}

def pdate(s):
    m = re.match(r'(\d{1,2})\s+([a-zéûô]+)\.?\s+(\d{4})', s.strip(), re.I)
    if not m: return None
    mo = MONTHS.get(m.group(2).lower().rstrip('.'))
    if not mo: return None
    try: return date(int(m.group(3)), mo, int(m.group(1)))
    except ValueError: return None

CTAS = ['En savoir plus','Learn More','Envoyer un message','Send Message','S’inscrire','S\'inscrire',
        'Sign Up','Itinéraire','Get directions','Contactez-nous','Contact us','Appeler','Call Now',
        'Télécharger','Download','Obtenir une offre','Get offer','Postuler','Apply Now','Voir plus',
        'Réserver','Book Now','Acheter','Shop Now','WhatsApp','Demander le prix','Get quote']
VIDEO_HINTS = ['Nous rencontrons des problèmes pour lire cette vidéo',
               'We are having trouble playing this video']

def clean(t):
    return [l.strip() for l in t.split('\n') if l.strip() and l.strip() != '​']

def parse_card(c):
    t = c['text']; lines = clean(t)
    o = {'libId': c['libId']}
    o['active'] = bool(re.search(r'^\s*Actif', t, re.M))
    o['versions'] = 'plusieurs versions' in t

    start = end = None
    for l in lines:
        m = re.match(r'(\d{1,2}\s+[a-zéûô]+\.?\s+\d{4})\s*-\s*(\d{1,2}\s+[a-zéûô]+\.?\s+\d{4})', l)
        if m:
            start, end = pdate(m.group(1)), pdate(m.group(2)); break
        m = re.match(r'D[ée]but de diffusion le\s+(.+)', l)
        if m:
            start = pdate(m.group(1)); break
    o['start'] = start.isoformat() if start else None
    o['end'] = end.isoformat() if end else None
    if start:
        o['days'] = ((end or TODAY) - start).days + 1
    else:
        o['days'] = None

    adv = ''
    for i, l in enumerate(lines):
        if 'Voir les d' in l and i + 1 < len(lines):
            adv = lines[i + 1]; break
    o['advertiser'] = adv

    body = []
    try:
        si = lines.index('Sponsorisé') + 1
    except ValueError:
        si = None
    if si:
        for l in lines[si:]:
            if l in CTAS or re.match(r'^[A-Z0-9][A-Z0-9\.\-/É]{4,}$', l) or l in VIDEO_HINTS:
                break
            body.append(l)
    o['body'] = '\n'.join(body).strip()

    dom = ''
    for l in lines:
        if re.match(r'^[A-Z0-9][A-Z0-9\.\-/É_]*\.[A-Z]{2,}', l) and ' ' not in l[:40]:
            dom = l; break
    o['domain'] = dom
    if dom:
        di = lines.index(dom)
        tail = [l for l in lines[di+1:di+4] if l not in CTAS]
        o['headline'] = tail[0] if tail else ''
        o['desc2'] = tail[1] if len(tail) > 1 else ''
    else:
        o['headline'] = o['desc2'] = ''

    o['cta'] = next((l for l in reversed(lines) if l in CTAS), '')
    o['isVideo'] = c.get('hasVideoEl') or any(h in t for h in VIDEO_HINTS)
    pm = re.search(r'Plateformes\s*(.*?)(?:Cat[ée]gories|Transparence|Cette publicit)', t, re.S)
    o['platformBlob'] = (pm.group(1).count('​') if pm else 0)
    return o

rows = []
DATA = os.environ.get('ADLIB_OUT', './data')
for f in sorted(glob.glob(os.path.join(DATA, '*.json'))):
    d = json.load(open(f))
    if not d.get('cards'): continue
    for c in d['cards']:
        r = parse_card(c); r['query'] = d['label']; rows.append(r)

# dedupe by libId, keep first
seen = {}
for r in rows:
    seen.setdefault(r['libId'], r)
rows = list(seen.values())
json.dump(rows, open(os.path.join(DATA, '..', 'parsed.json'), 'w'), ensure_ascii=False, indent=1)
print('pubs uniques:', len(rows))
