# Vérifie les 478 leads pest control : franchises, réseaux, grandes entreprises, lignes nationales,
# portable publié sur le site, fiabilité du nom du gérant. Écrit un rapport à relire avant d'exclure.
import json, os, re, sys, unicodedata, collections as C
from urllib.parse import urlparse

def strip(s): return unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().lower()
def words(s): return re.sub(r'[^a-z0-9]+', ' ', strip(s)).split()
def dom(u):
    if not u: return ''
    return urlparse(u if '//' in u else 'http://' + u).netloc.lower().replace('www.', '')
def tel10(s):
    d = re.sub(r'\D', '', s or '')
    if d.startswith('0033'): d = '0' + d[4:]
    elif d.startswith('33') and len(d) == 11: d = '0' + d[2:]
    return d if len(d) == 10 and d[0] == '0' and d[1] != '0' else None
def fmt(d): return ' '.join(d[i:i + 2] for i in range(0, 10, 2))

L = json.load(open('leads_pest.json'))
REG = json.load(open('reg_check.json')) if os.path.exists('reg_check.json') else {}
def site(l):
    f = f"sites/{l['id']}.json"
    return json.load(open(f)) if os.path.exists(f) else None

# Réseaux connus dans la 3D (franchises, groupes nationaux), et marques vues dans plusieurs villes de la collecte
NETWORK = re.compile(r'eden\s?vert|sanipure|avipur|\belis\b|\bngan\b|pestaly|quanttum|lecongelo|farago|hygi[eè]ne office|rentokil|\binitial\b|anticimex|sapian|ecolab|isotech|hygial|axe environnement|a3d hygi', re.I)
FRANCH = re.compile(r'franchis[ée]s?\b|franchise|devenir (?:franchis|partenaire|licenci)|r[ée]seau (?:national|de \d+|d.agences|de franchis|de techniciens)|\b\d{2,3}\s+agences|nos agences|agences? (?:partout|dans toute)|pr[ée]sents? dans toute la france|partout en france|toute la france|implant[ée]s? (?:dans|partout|sur)|leader (?:fran[çc]ais|national|europ)|n°\s?1 (?:fran|de la|du)|num[ée]ro 1 (?:fran|de la|du)', re.I)
NETTXT = re.compile(r'rentokil|anticimex|sapian|ecolab|eden\s?vert|sanipure|avipur|\bngan\b|pestaly|quanttum|lecongelo|farago|hygi[eè]ne office|isotech|hygial', re.I)
CAPITAL = re.compile(r'capital(?: social)?(?: de| :|:)?\s*([\d][\d\s.,]{2,})\s*(?:€|euros|eur)', re.I)
PHONE = re.compile(r'(?:\+33\s?\(?0?\)?\s?|0033\s?|\b0)[1-9](?:[\s.\-]?\d{2}){4}\b')
NAMEPAT = r"((?:[A-ZÉÈÀÂÎÔÛÇ][a-zéèêëàâîïôûüç\-]+|[A-ZÉÈÀÂÎÔÛÇ\-]{2,})(?:\s+(?:[A-ZÉÈÀÂÎÔÛÇ][a-zéèêëàâîïôûüç\-]+|[A-ZÉÈÀÂÎÔÛÇ\-]{2,})){1,2})"
RESP = re.compile(r"(?:responsable|directeur|directrice)\s+(?:de\s+(?:la\s+)?)?(?:publication|du site|de la r[ée]daction)\s*[:\-–]?\s*(?:M\.|Mme|Monsieur|Madame)?\s*" + NAMEPAT + r"|(?:g[ée]rant|g[ée]rante|dirig[ée]e? par|fondateur|fondatrice|propri[ée]taire|pr[ée]sident)\s*[:\-–]?\s*(?:M\.|Mme|Monsieur|Madame)?\s*" + NAMEPAT)
SIR = re.compile(r'(?:SIREN|SIRET|RCS|R\.C\.S\.?)[^0-9]{0,40}((?:\d[\s.]?){9})', re.I)
STOPNAME = set('le la les de du des site société societe sarl sas eurl sasu entreprise nuisibles nuisible contact mentions légales legales accueil hébergeur hebergeur ovh ionos wix google france'.split())

# Indicatif fixe attendu par département
def zone_dep(dep):
    if not dep: return None
    if dep in ('75', '77', '78', '91', '92', '93', '94', '95'): return '01'
    if dep in ('14', '18', '22', '27', '28', '29', '35', '36', '37', '41', '44', '45', '49', '50', '53', '56', '61', '72', '76', '85'): return '02'
    if dep in ('02', '08', '10', '21', '25', '39', '51', '52', '54', '55', '57', '58', '59', '60', '62', '67', '68', '70', '71', '80', '88', '89', '90'): return '03'
    if dep in ('01', '03', '04', '05', '06', '07', '13', '15', '26', '2A', '2B', '30', '34', '38', '42', '43', '48', '63', '66', '69', '73', '74', '83', '84', '11'): return '04'
    return '05'

# Numéros vus sur plusieurs sites (lignes partagées = centre d'appel ou réseau)
siteTels = {}
for l in L:
    s = site(l)
    if not s or not s.get('ok'): continue
    ts = set()
    for p in s['pages']:
        for m in PHONE.findall(p['text']): ts.add(tel10(m))
        for m in p['tels']: ts.add(tel10(m))
    siteTels[l['id']] = {t for t in ts if t}
telSites = C.defaultdict(set)
for i, ts in siteTels.items():
    for t in ts: telSites[t].add(i)
googleTel = {re.sub(r'\D', '', l['tel']): l['id'] for l in L}

def capv(x):
    d = re.sub(r'\D', '', re.sub(r'[.,]\d{1,2}\s*$', '', x.strip()))
    return int(d) if d else 0
capSeen = C.Counter()
for l in L:
    s = site(l)
    if s and s.get('ok'):
        for c in {capv(x) for p in s['pages'] for x in CAPITAL.findall(p['text']) if capv(x)}: capSeen[c] += 1
rows = []
for l in L:
    s = site(l); f = {'id': l['id'], 'nom': l['annonceur'], 'ville': l['ville'], 'flags': [], 'site': l.get('site')}
    dep = str(l.get('cp') or '')[:2] if re.fullmatch(r'\d{5}', str(l.get('cp') or '')) else None
    g = re.sub(r'\D', '', l['tel'])
    txt = ' '.join(p['text'] for p in s['pages']) if s and s.get('ok') else ''
    # 1. marques et réseaux
    if NETWORK.search(l['annonceur'] or '') or NETWORK.search(dom(l.get('site'))): f['flags'].append('réseau connu (nom)')
    m = FRANCH.findall(txt)
    if m: f['flags'].append('site : ' + ', '.join(sorted({x.lower() for x in m}))[:120])
    nt = {x.lower() for x in NETTXT.findall(txt)}
    if nt: f['flags'].append('site cite : ' + ', '.join(sorted(nt)))
    f['ctx'] = [txt[max(0, mm.start() - 110):mm.end() + 110] for mm in list(FRANCH.finditer(txt))[:4]]
    cap = [capv(x) for x in CAPITAL.findall(txt) if capv(x)]
    cap = [c for c in cap if capSeen[c] < 2]
    if cap and max(cap) >= 500000: f['flags'].append(f'capital {max(cap):,} €'.replace(',', ' '))
    # 2. registre
    r = REG.get(l.get('siren') or '') or {}
    if r:
        if (r.get('etab') or 0) >= 3: f['flags'].append(f"{r['etab']} établissements ouverts")
        if r.get('cat') in ('ETI', 'GE'): f['flags'].append('catégorie ' + r['cat'])
        if r.get('ca') and r['ca'] >= 1500000: f['flags'].append(f"CA {r['ca']:,} € ({r['caAn']})".replace(',', ' '))
        if r.get('eff') in ('11', '12', '21', '22', '31', '32', '41', '42', '51', '52', '53'): f['flags'].append('effectif ' + r['eff'])
        if dep and r.get('siegeDep') and r['siegeDep'] != dep and (r.get('etab') or 0) >= 2: f['flags'].append(f"siège dans le {r['siegeDep']} ({r.get('siegeVille')})")
        if r.get('dirMorale'): f['flags'].append('dirigé par une société : ' + ', '.join(r['dirMorale'])[:80])
    # 3. téléphone
    if g.startswith('08'): f['flags'].append('numéro national 08')
    z = zone_dep(dep)
    if g[:2] in ('01', '02', '03', '04', '05') and z and g[:2] != z: f['flags'].append(f'fixe en {g[:2]} pour le département {dep}')
    if len(telSites.get(g, set()) - {l['id']}) >= 1: f['flags'].append('son numéro est aussi sur un autre site')
    if s and s.get('ok'):
        ts = siteTels.get(l['id'], set())
        mob = [t for t in ts if t[:2] in ('06', '07')]
        f['nbTelSite'] = len(ts)
        if len(ts) >= 6: f['flags'].append(f'{len(ts)} numéros différents sur le site')
        if ts and g not in ts: f['googleAbsentDuSite'] = True
        # portable publié par l'entreprise (seulement si le numéro Google est un fixe)
        if not l['mobile']:
            own = [t for t in mob if not (telSites[t] - {l['id']}) and t not in googleTel]
            if 1 <= len(own) <= 2:
                # page où il apparaît
                where = None
                for p in s['pages']:
                    if any(tel10(x) == own[0] for x in PHONE.findall(p['text']) + p['tels']):
                        where = 'mentions légales' if re.search(r'mention|legal|l[ée]gal', p['url'], re.I) else 'page contact' if re.search(r'contact', p['url'], re.I) else "page d'accueil" if p is s['pages'][0] else 'page ' + urlparse(p['url']).path.strip('/')[:30]
                        break
                f['mobileSite'] = fmt(own[0]); f['mobileSiteOu'] = where
            elif len(own) > 2: f['flags'].append(f'{len(own)} portables différents sur le site')
        # nom dans les mentions légales
        names = []
        for p in s['pages']:
            for mm in RESP.finditer(p['text']):
                n = (mm.group(1) or mm.group(2) or '').strip()
                if n and not (set(words(n)) & STOPNAME): names.append(n)
        if names: f['nomSite'] = C.Counter(names).most_common(1)[0][0]
        sir = {re.sub(r'\D', '', x)[:9] for x in SIR.findall(txt)}
        f['sirenSite'] = sorted(sir)
    # 4. fiabilité du nom
    if l.get('dirigeant'):
        last = strip(l['dirigeant']).split()[-1]
        if l.get('regSource', '').startswith('n° SIREN'): f['nomFiab'] = 'sur'
        elif l.get('siren') in f.get('sirenSite', []) or (last and len(last) > 2 and last in strip(txt)): f['nomFiab'] = 'sur'
        elif f.get('sirenSite') and l.get('siren') not in f['sirenSite']: f['nomFiab'] = 'a_confirmer'; f['flags'].append('SIREN du site différent du registre')
        elif l.get('creation') in ('2025', '2026') and (l.get('avis') or 0) >= 30: f['nomFiab'] = 'a_confirmer'
        else: f['nomFiab'] = 'probable'
    rows.append(f)

json.dump(rows, open('verify.json', 'w'), ensure_ascii=False, indent=0)
fl = [r for r in rows if r['flags']]
print('leads', len(rows), '· signalés', len(fl), '· portable trouvé sur le site', sum(1 for r in rows if r.get('mobileSite')),
      '· nom trouvé sur le site', sum(1 for r in rows if r.get('nomSite')), '· fiabilité', C.Counter(r.get('nomFiab') for r in rows))
for r in fl: print('-', r['nom'][:50], '|', r['ville'], '|', dom(r['site']), '|', ' ; '.join(r['flags']))
