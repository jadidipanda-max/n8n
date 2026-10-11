# Chauffage / climatisation / plomberie-chauffage : tri des fiches Google, lecture des sites, registre,
# signaux de franchise ou de standard, note ICP. Écrit leads_cvc.json et un rapport à relire avant d'exclure.
#
# ICP : entreprise indépendante, 3 à 15 personnes (au moins 2 techniciens), dépannage + entretien + installation,
# 30 avis Google ou plus, plusieurs communes, urgence ou intervention rapide affichée, pas de standard permanent,
# gérant joignable sur son portable.
import json, os, re, time, unicodedata, collections as C, concurrent.futures as cf, requests, html as H
from urllib.parse import urlparse, urljoin

RAW = json.load(open('raw/maps.json'))
os.makedirs('sites', exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept-Language': 'fr-FR,fr;q=0.9'}

def strip(s): return unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().lower()
def words(s): return re.sub(r'[^a-z0-9]+', ' ', strip(s)).split()
def dom(u):
    if not u: return ''
    return urlparse(u if '//' in u else 'http://' + u).netloc.lower().replace('www.', '')
HOSTING = ('netlify.app', 'vercel.app', 'wixsite.com', 'webnode.fr', 'webnode.page', 'e-monsite.com', 'jimdofree.com', 'site123.me', 'godaddysites.com', 'wordpress.com', 'github.io', 'business.site', 'site-solocal.com', 'pagesperso-orange.fr', 'free.fr', 'over-blog.com', 'weebly.com', 'square.site', 'onepage.website')
def root(d):
    r = '.'.join(d.split('.')[-2:])
    return d if r in HOSTING else r
def tel10(s):
    d = re.sub(r'\D', '', s or '')
    if d.startswith('0033'): d = '0' + d[4:]
    elif d.startswith('33') and len(d) == 11: d = '0' + d[2:]
    return d if len(d) == 10 and d[0] == '0' and d[1] != '0' else None
def fmt(d): return ' '.join(d[i:i + 2] for i in range(0, 10, 2)) if d else None

TRADE = re.compile(r'chauffag|climatis|plomb|pompe a chaleur|pompes a chaleur|\bpac\b|chaudiere|frigori|genie climatique|\bcvc\b|thermique|sanitaire|ventilation|energies? renouvelable', re.I)
NOTTRADE = re.compile(r'magasin|grossiste|fabricant|distributeur|negociant|bureau d.etudes|ecole|formation|location|quincaillerie|grande surface|bricolage|electromenager|agence immobili|automobile|entrepot|piscine', re.I)
BIG = re.compile(r'engie|savelys|proxiserve|dalkia|\bidex\b|equans|cofely|\bspie\b|vinci|eiffage|bouygues|elm\.? ?leblanc|izi by edf|\bedf\b|hellio|effy|quelle ?energie|leroy merlin|castorama|brico|weldom|boulanger|darty|cedeo|point\.? ?p\b|brossette|richardson|leclerc|carrefour|auchan|but\b|conforama|axeo|sanidom|mr\.? ?bricolage', re.I)
CITIES = ["Nice", "Nantes", "Montpellier", "Strasbourg", "Bordeaux", "Lille", "Rennes", "Reims", "Toulon", "Saint-Étienne", "Le Havre", "Grenoble", "Dijon", "Angers", "Nîmes",
          "Clermont-Ferrand", "Aix-en-Provence", "Le Mans", "Brest", "Tours", "Amiens", "Limoges", "Perpignan", "Metz", "Besançon", "Orléans", "Rouen", "Caen", "Nancy", "Avignon"]
def city_of(search):
    s = strip(search)
    for c in CITIES:
        if s.endswith(strip(c)): return c
    return ''

# 1. Tri de base
seen, places, excl = set(), [], C.Counter()
for p in RAW:
    pid = p.get('placeId')
    if not pid or pid in seen: continue
    seen.add(pid)
    if p.get('permanentlyClosed') or p.get('temporarilyClosed'): excl['fermé'] += 1; continue
    t = tel10(p.get('phoneUnformatted') or p.get('phone'))
    if not t: excl['sans téléphone'] += 1; continue
    if t.startswith('08'): excl['numéro national 08'] += 1; continue
    cats = ' '.join([p.get('categoryName') or ''] + (p.get('categories') or []))
    if not (TRADE.search(strip(cats)) or TRADE.search(strip(p.get('title')))): excl['pas du métier'] += 1; continue
    if NOTTRADE.search(strip(p.get('categoryName'))): excl['magasin, grossiste ou autre métier'] += 1; continue
    if BIG.search(p.get('title') or '') or (not any(x in dom(p.get('website')) for x in ('wixsite', 'solocal', 'business.site', 'jimdo', 'netlify', 'webnode', 'e-monsite')) and BIG.search(dom(p.get('website')))): excl['grand groupe, enseigne ou distributeur'] += 1; continue
    if (p.get('reviewsCount') or 0) < 30: excl['moins de 30 avis Google'] += 1; continue
    p['_tel'] = t; p['_ville_rech'] = city_of(p.get('searchString'))
    places.append(p)

# 2. Réseaux : même numéro, même site ou même marque dans plusieurs villes
NOT_SITE = ('facebook.', 'instagram.', 'pagesjaunes', 'google.', 'linktr', 'business.site', 'wixsite', 'solocal', 'site-solocal', 'travaux.com', 'habitatpresto', 'starofservice', 'allovoisins', 'jimdo', 'sites.google')
byTel, byDom = C.defaultdict(set), C.defaultdict(set)
for p in places:
    byTel[p['_tel']].add(strip(p.get('city')))
    d = dom(p.get('website'))
    if d and not any(x in d for x in NOT_SITE): byDom[root(d)].add(strip(p.get('city')))
keep = []
for p in places:
    d = dom(p.get('website'))
    if len(byTel[p['_tel']]) >= 2: excl['même numéro dans plusieurs villes'] += 1; continue
    if d and not any(x in d for x in NOT_SITE) and len(byDom.get(root(d), ())) >= 2: excl['même site dans plusieurs villes'] += 1; continue
    keep.append(p)
best = {}
for p in keep:
    k = p['_tel']
    if k not in best or (p.get('reviewsCount') or 0) > (best[k].get('reviewsCount') or 0): best[k] = p
excl['doublon de numéro'] += len(keep) - len(best)
keep = list(best.values())
print('fiches brutes', len(RAW), '· après tri de base', len(keep), '· exclues', dict(excl), flush=True)

# 3. Lecture des sites (accueil + contact, mentions légales, à propos, zone, services, agences)
KEY = re.compile(r'contact|mention|legal|l[ée]gal|propos|qui-sommes|societe|entreprise|equipe|agence|implantation|franchise|zone|intervention|secteur|depannage|entretien|services?', re.I)
S = requests.Session()
def get(u):
    try:
        r = S.get(u, headers=UA, timeout=12, allow_redirects=True)
        if r.status_code < 400 and 'html' in r.headers.get('content-type', ''): return r
    except Exception: return None
def text(h):
    h = re.sub(r'(?is)<(script|style|noscript)[^>]*>.*?</\1>', ' ', h)
    return re.sub(r'\s+', ' ', H.unescape(re.sub(r'<[^>]+>', ' ', h))).strip()
FORM = re.compile(r'<form[^>]*>(?:(?!</form>).){0,6000}?(?:type=["\'](?:email|tel)["\']|<textarea|name=["\'][^"\']*(?:mail|tel|phone|message))', re.I | re.S)
CHAT = re.compile(r'tawk\.to|crisp\.chat|tidio|intercom|livechat|zendesk|chatbot|wa\.me|whatsapp|smartsupp|chaport', re.I)
def crawl(p):
    out = f"sites/{p['placeId']}.json"
    if os.path.exists(out): return json.load(open(out))
    u = p.get('website') or ''
    if not u or any(x in dom(u) for x in NOT_SITE): return {'ok': False, 'absent': True}
    r = get(u if '//' in u else 'http://' + u)
    if not r: d = {'ok': False}; json.dump(d, open(out, 'w')); return d
    base = dom(r.url); pages = [(r.url, r.text)]; seen = {r.url.rstrip('/')}; links = []
    for a in re.findall(r'href=["\']([^"\'#]+)["\']', r.text):
        f = urljoin(r.url, a)
        if dom(f) == base and KEY.search(urlparse(f).path) and f.rstrip('/') not in seen:
            seen.add(f.rstrip('/')); links.append(f)
    for f in links[:8]:
        rr = get(f)
        if rr: pages.append((rr.url, rr.text))
    d = {'ok': True, 'form': any(FORM.search(h) for _, h in pages), 'chat': any(CHAT.search(h) for _, h in pages),
         'pages': [{'url': pu, 'text': text(ph)[:60000], 'tels': re.findall(r'href=["\']tel:([^"\']+)', ph, re.I)} for pu, ph in pages]}
    json.dump(d, open(out, 'w'), ensure_ascii=False)
    return d
with cf.ThreadPoolExecutor(16) as ex:
    for p, s in zip(keep, ex.map(crawl, keep)): p['_s'] = s
print('sites lus', sum(1 for p in keep if p['_s'].get('ok')), '/', len(keep), flush=True)

# 4. Registre : SIREN du site, sinon nom + département ; puis taille, établissements, siège, dirigeant
SIR = re.compile(r'(?:SIREN|SIRET|RCS|R\.C\.S\.?)[^0-9]{0,40}((?:\d[\s.]?){9})', re.I)
_sirSeen = C.Counter(s for p in keep if p['_s'].get('ok') for s in {re.sub(r'\D', '', x)[:9] for x in SIR.findall(' '.join(y['text'] for y in p['_s']['pages']))})
HOSTS = {s for s, n in _sirSeen.items() if n >= 2} | {'424761419'}  # SIREN cité sur plusieurs sites = hébergeur ou agence web (424761419 = OVH)
GEN = set(('le la les l de du des d et en a au aux sas sarl eurl ei sasu sa services service chauffage chauffagiste chauffagistes plomberie plombier plombiers climatisation clim '
           'sanitaire sanitaires energie energies thermique thermiques depannage depannages entretien installation installations pompe pompes chaleur pac gaz chaudiere chaudieres '
           'renovation salle bain bains genie climatique ventilation froid frigorifique solaire confort habitat batiment eau expert experts pro pros solution solutions groupe group '
           'france sud ouest est nord centre entreprise societe ets etablissements fils freres and the 24 7 24h 7j7 urgence rapide maintenance technique techniques').split())
APE_OK = ('43.', '33.', '71.12', '28.25', '81.10')
EFF = {'NN': None, '00': '0 salarié', '01': '1-2 salariés', '02': '3-5 salariés', '03': '6-9 salariés', '11': '10-19 salariés', '12': '20-49 salariés', '21': '50-99 salariés', '22': '100-199 salariés'}
RS = requests.Session()
def api(params):
    for i in range(6):
        try:
            r = RS.get('https://recherche-entreprises.api.gouv.fr/search', params=dict(params, per_page=10), timeout=25)
            if r.status_code == 429: time.sleep(3 + 3 * i); continue
            if r.status_code == 200: time.sleep(0.5); return r.json().get('results', [])
        except Exception: time.sleep(2 + i)
    return None
def sitetext(p): return ' '.join(x['text'] for x in p['_s'].get('pages', [])) if p['_s'].get('ok') else ''
def reg(p):
    cp = p.get('postalCode') or ''; dep = cp[:2] if re.fullmatch(r'\d{5}', cp) else None
    sir = [re.sub(r'\D', '', x)[:9] for x in SIR.findall(sitetext(p))]
    sir = [s for s in sir if s not in HOSTS]
    for s in dict.fromkeys(sir):
        res = api({'q': s}) or []
        r = next((x for x in res if x.get('siren') == s), None)
        if r: return r, 'n° SIREN des mentions légales'
    base = re.split(r'\s[-–|]\s|\|', p.get('title') or '')[0]
    dist = [w for w in words(base) if w not in GEN and len(w) > 1]
    if not dist: return None, 'nom trop générique'
    params = {'q': ' '.join(words(base))}
    if dep: params['departement'] = dep
    for r in api(params) or []:
        if r.get('etat_administratif') != 'A': continue
        names = [r.get('nom_complet') or '', r.get('nom_raison_sociale') or ''] + list(((r.get('siege') or {}).get('liste_enseignes')) or [])
        if any(set(dist) <= set(words(n)) for n in names):
            if (r.get('activite_principale') or '').startswith(APE_OK) or TRADE.search(strip(' '.join(names))):
                return r, 'nom + département'
    return None, 'pas trouvé'
REGC = json.load(open('reg_cache.json')) if os.path.exists('reg_cache.json') else {}
def reg_c(p):
    if p['placeId'] in REGC: return tuple(REGC[p['placeId']])
    rr = reg(p)
    REGC[p['placeId']] = list(rr)
    return rr
with cf.ThreadPoolExecutor(3) as ex:
    for p, rr in zip(keep, ex.map(reg_c, keep)): p['_reg'] = rr
json.dump(REGC, open('reg_cache.json', 'w'), ensure_ascii=False)
print('registre interrogé', flush=True)
def person(r):
    for d in r.get('dirigeants', []):
        if d.get('type_dirigeant') == 'personne physique' and d.get('nom') and 'diffusible' not in (d.get('nom') or '').lower():
            return ((d.get('prenoms') or '').split(' ')[0].title() + ' ' + re.sub(r'\s*\(.*?\)', '', d['nom']).title()).strip(), d.get('qualite') or 'Dirigeant'
    if r.get('nature_juridique') == '1000' and 'diffusible' not in (r.get('nom_complet') or '').lower():
        return ' '.join(w.title() for w in re.sub(r'\(.*?\)', '', r.get('nom_complet') or '').split()), 'Entrepreneur individuel'
    return None, None

# 5. Signaux sur le site
PHONE = re.compile(r'(?:\+33\s?\(?0?\)?\s?|0033\s?|\b0)[1-9](?:[\s.\-]?\d{2}){4}\b')
DEP = re.compile(r'd[ée]pann|panne|r[ée]paration|sav\b', re.I)
ENT = re.compile(r'entretien|contrat d.entretien|maintenance|visite annuelle|ramonage', re.I)
INS = re.compile(r'installation|pose de|remplacement de (?:votre )?chaudi|pompe [àa] chaleur|climatiseur', re.I)
URG = re.compile(r'urgence|24\s?h\s?/\s?24|24\s?/\s?7|7\s?j\s?/\s?7|7\s?jours\s?sur\s?7|intervention rapide|sous 24|sous 48|dans la journ[ée]e|le jour m[êe]me|astreinte|d[ée]pannage rapide', re.I)
ZONE = re.compile(r"zone d.intervention|secteur d.intervention|nous intervenons (?:sur|dans|[àa])|intervenons dans un rayon|communes? (?:environnantes|alentours|suivantes)|alentours|dans un rayon de \d+", re.I)
CP = re.compile(r'\b(?:0[1-9]|[1-8]\d|9[0-5])\d{3}\b')
ACCUEIL = re.compile(r"secr[ée]tariat|standard t[ée]l[ée]phonique|service client|accueil t[ée]l[ée]phonique|permanence t[ée]l[ée]phonique|nos conseill[eè]res?|assistante? (?:administrative|commerciale)", re.I)
FRANCH = re.compile(r"franchis[ée]s?\b|franchise (?:nationale|de|du r[ée]seau)|devenir (?:franchis|partenaire|licenci)|r[ée]seau (?:national|de \d+|d.agences|de franchis|d.installateurs)|\b\d{2,3}\s+agences|nos agences|agences? (?:partout|dans toute)|pr[ée]sents? dans toute la france|partout en france|leader (?:fran[çc]ais|national|europ)", re.I)
CAPITAL = re.compile(r'capital(?: social)?(?: de| :|:)?\s*([\d][\d\s.,]{2,})\s*(?:€|euros|eur)', re.I)
RESP = re.compile(r"(?:responsable|directeur|directrice)\s+(?:de\s+(?:la\s+)?)?(?:publication|du site)\s*[:\-–]?\s*(?:M\.|Mme|Monsieur|Madame)?\s*((?:[A-ZÉÈÀÂÎÔÛÇ][a-zéèêëàâîïôûüç\-]+|[A-ZÉÈÀÂÎÔÛÇ\-]{2,})\s+(?:[A-ZÉÈÀÂÎÔÛÇ][a-zéèêëàâîïôûüç\-]+|[A-ZÉÈÀÂÎÔÛÇ\-]{2,}))")
AGENCY = re.compile(r'h[ée]berg|hostinger|\bovh\b|ionos|r[ée]alis[ée] par|conception|agence web|webmaster|d[ée]velopp|cr[ée]ation du site|design', re.I)
FREEMAIL = ('gmail.', 'hotmail.', 'orange.', 'free.', 'outlook.', 'yahoo.', 'laposte.', 'wanadoo.', 'sfr.', 'icloud.', 'live.', 'neuf.', 'bbox.')
def capv(x):
    d = re.sub(r'\D', '', re.sub(r'[.,]\d{1,2}\s*$', '', x.strip()))
    return int(d) if d else 0
siteTels = {}
for p in keep:
    ts = set()
    for x in p['_s'].get('pages', []):
        ts |= {tel10(m) for m in PHONE.findall(x['text'])} | {tel10(m) for m in x['tels']}
    siteTels[p['placeId']] = {t for t in ts if t}
telSites = C.defaultdict(set)
for i, ts in siteTels.items():
    for t in ts: telSites[t].add(i)
capSeen = C.Counter(c for p in keep for c in {capv(x) for x in CAPITAL.findall(sitetext(p)) if capv(x)})

# 6. Fiches, note ICP
leads, ex2, review = [], C.Counter(), []
for p in keep:
    r, how = p['_reg']; s = p['_s']; txt = sitetext(p); pid = p['placeId']
    r = r or {}
    eff = r.get('tranche_effectif_salarie')
    nature = r.get('nature_juridique'); etab = r.get('nombre_etablissements_ouverts') or 0
    if eff in ('12', '21', '22', '31', '32', '41', '42', '51', '52', '53'): ex2['20 salariés ou plus'] += 1; continue
    if r.get('categorie_entreprise') in ('ETI', 'GE'): ex2['entreprise de taille intermédiaire ou grande'] += 1; continue
    if eff == '00': ex2['aucun salarié (seul)'] += 1; continue
    if (r.get('activite_principale') or '').startswith(('46.', '47.')): ex2['commerce ou négoce (code d’activité de vente)'] += 1; continue
    nom, qual = person(r) if r else (None, None)
    nonDiff = bool(r) and 'diffusible' in json.dumps(r.get('dirigeants') or [], ensure_ascii=False).lower() + (r.get('nom_complet') or '').lower()
    flags, att = [], []
    cp = p.get('postalCode') or ''; dep = cp[:2] if re.fullmatch(r'\d{5}', cp) else None
    sg = r.get('siege') or {}
    if etab >= 3 and nature != '1000': flags.append(f'{etab} établissements ouverts')
    if dep and sg.get('departement') and sg['departement'] != dep and etab >= 2: flags.append(f"siège dans le {sg['departement']} ({sg.get('libelle_commune')})")
    morale = [d.get('denomination') for d in r.get('dirigeants') or [] if d.get('type_dirigeant') == 'personne morale']
    if morale: flags.append('dirigée par une société : ' + ', '.join(morale)[:80])
    fin = r.get('finances') or {}; yr = max(fin) if fin else None; ca = (fin.get(yr) or {}).get('ca') if yr else None
    if ca and ca >= 2500000: flags.append(f'CA {ca:,} € ({yr})'.replace(',', ' '))
    fm = FRANCH.findall(txt)
    if fm: flags.append('site : ' + ', '.join(sorted({x.lower() for x in fm}))[:120])
    cap = [c for c in (capv(x) for x in CAPITAL.findall(txt)) if c and capSeen[c] < 2]
    if cap and max(cap) >= 500000: flags.append(f'capital {max(cap):,} €'.replace(',', ' '))
    if len(telSites[p['_tel']] - {pid}) >= 1: flags.append('son numéro est aussi sur un autre site')
    ts = siteTels.get(pid, set())
    if len(ts) >= 6: flags.append(f'{len(ts)} numéros différents sur le site')
    if p['_tel'][:2] in ('01', '09') and ts and p['_tel'] not in ts: flags.append('numéro de la fiche absent du site (renvoi ou centre d’appel ?)')
    # portable : celui de la fiche, sinon celui publié par l'entreprise sur son site
    mobile = p['_tel'][:2] in ('06', '07'); tel, telG, telSrc = p['_tel'], None, 'Fiche Google'
    if not mobile and s.get('ok'):
        own = [t for t in ts if t[:2] in ('06', '07') and not (telSites[t] - {pid})]
        if 1 <= len(own) <= 2:
            for x in s['pages']:
                m = re.search(r'(?:\+33\s?|0)' + own[0][1] + r'[\s.\-]?' + r'[\s.\-]?'.join(own[0][i:i + 2] for i in range(2, 10, 2)), x['text'])
                if not m: continue
                before, after = x['text'][max(0, m.start() - 220):m.start()], x['text'][m.end():m.end() + 80]
                mail = re.search(r'[\w.+-]+@([\w-]+\.[\w.]+)', after)
                agence = AGENCY.search(before) and not re.search(r'directeur|directrice|responsable|g[ée]rant', before[-120:], re.I)
                autre = mail and not mail.group(1).lower().startswith(FREEMAIL) and root(dom(p.get('website'))).split('.')[0] not in mail.group(1).lower()
                if not agence and not autre:
                    where = 'mentions légales' if re.search(r'mention|legal|l[ée]gal', x['url'], re.I) else 'page contact' if 'contact' in x['url'].lower() else "page d'accueil" if x is s['pages'][0] else 'site'
                    telG, tel, mobile, telSrc = p['_tel'], own[0], True, f'Portable affiché sur son site ({where})'
                break
        elif len(own) > 2: flags.append(f'{len(own)} portables différents sur le site')
    # nom du gérant et fiabilité
    nomFiab = None; regSrc = how if r else None
    if nom:
        last = strip(nom).split()[-1]
        nomFiab = 'sur' if how.startswith('n° SIREN') or (len(last) > 2 and last in strip(txt)) else 'probable'
        crea = (r.get('date_creation') or '')[:4]
        if nomFiab == 'probable' and crea in ('2025', '2026') and (p.get('reviewsCount') or 0) >= 30: nomFiab = 'a_confirmer'
    elif s.get('ok'):
        ns = [m.group(1) for x in s['pages'] for m in RESP.finditer(x['text'])]
        if ns: nom, qual, nomFiab, regSrc = C.Counter(ns).most_common(1)[0][0].title(), 'Responsable du site', 'site', 'mentions légales de son site'
    if nonDiff: att.append("Au registre, il a demandé que son nom ne soit pas diffusé : " + ("le nom affiché vient de son propre site" if nomFiab == 'site' else "demande le gérant sans citer de nom"))
    # critères ICP
    dep_ = bool(DEP.search(txt) or DEP.search(strip(p.get('title')))); ent = bool(ENT.search(txt)); ins = bool(INS.search(txt))
    urg = bool(URG.search(txt) or URG.search(p.get('title') or ''))
    zone = bool(ZONE.search(txt)) or len(set(CP.findall(txt))) >= 4
    accueil = bool(ACCUEIL.search(txt))
    if accueil: att.append('Son site parle de secrétariat ou de service client : vérifie qui décroche')
    if eff == '11': att.append('10 à 19 salariés : vérifie qu’il reste sous 15 personnes')
    if eff in (None, 'NN') or not r: att.append('Taille inconnue au registre : demande combien de techniciens')
    if etab == 2: att.append('2 établissements au registre')
    pts, why = 0, []
    if mobile: pts += 2; why.append(('Portable sur son site' if telG else 'Portable') + ' : il décroche lui-même (+2)')
    if eff in ('02', '03'): pts += 2; why.append(f'{EFF[eff]} : la taille visée (+2)')
    elif eff in ('01', '11'): pts += 1; why.append(f'{EFF[eff]} : taille limite (+1)')
    avis = p.get('reviewsCount') or 0
    if avis <= 200: pts += 1; why.append(f'{avis} avis Google : actif sans être dominant (+1)')
    if urg: pts += 1; why.append('Urgence ou intervention rapide affichée (+1)')
    if dep_ and ent: pts += 1; why.append('Dépannage et entretien (+1)')
    if zone: pts += 1; why.append('Plusieurs communes desservies (+1)')
    if accueil: pts -= 1; why.append('Secrétariat ou service client mentionné (−1)')
    prio = 'P1' if pts >= 6 else 'P2' if pts >= 4 else 'P3'
    etat = 'absent' if s.get('absent') else 'a_verifier' if not s.get('ok') else 'chat' if s.get('chat') else 'form' if s.get('form') else 'sans_form'
    raisons = [x for x, ok in (('dépannage', dep_), ('entretien', ent), ('installation', ins)) if ok]
    siteR = (['fait : ' + ', '.join(raisons)] if raisons else []) + (["met en avant l'urgence"] if urg else []) + (['plusieurs communes'] if zone else [])
    acc = ("Quand vous êtes chez un client ou sous une chaudière, qui répond à votre téléphone ? "
           "En pleine saison de chauffe, un client sans chauffage appelle le suivant s'il tombe sur la messagerie. "
           "On met en place un assistant téléphonique qui décroche quand vous ne pouvez pas, note l'adresse, l'appareil et la panne, "
           "propose un créneau et vous envoie un SMS tout de suite. Vous gardez votre numéro.")
    lead = {'id': 'g' + pid, 'score': pts, 'zone': prio, 'niche': p['_ville_rech'] or p.get('city'),
            'annonceur': p.get('title'), 'categorie': p.get('categoryName'),
            'dirigeant': nom, 'qualite': qual, 'nomFiab': nomFiab, 'nonDiffusible': nonDiff or None,
            'entreprise': None if nonDiff else r.get('nom_complet'), 'siren': r.get('siren'),
            'urlSiren': ('https://annuaire-entreprises.data.gouv.fr/entreprise/' + r['siren']) if r.get('siren') else None,
            'regSource': regSrc, 'creation': (r.get('date_creation') or '')[:4] or None, 'effectif': EFF.get(eff) if r else None, 'etab': etab or None,
            'ville': p.get('city') or p['_ville_rech'], 'cp': p.get('postalCode'), 'tel': fmt(tel), 'telGoogle': fmt(telG), 'telSource': telSrc, 'mobile': mobile,
            'noteGoogle': p.get('totalScore'), 'avis': avis, 'site': p.get('website') or '', 'siteEtat': etat, 'siteRaisons': siteR,
            'depannage': dep_, 'entretien': ent, 'installation': ins, 'urgence': urg, 'multiCommunes': zone, 'accueil': accueil,
            'urlMaps': p.get('url') or ('https://www.google.com/maps/search/?api=1&query=' + requests.utils.quote(p.get('title') or '') + '&query_place_id=' + pid),
            'accroche': acc, 'pourquoi': ' · '.join(why), 'attention': att}
    leads.append(lead)
    if flags: review.append({'id': lead['id'], 'nom': p.get('title'), 'ville': lead['ville'], 'site': lead['site'], 'flags': flags,
                             'ctx': [txt[max(0, m.start() - 120):m.end() + 120] for m in list(FRANCH.finditer(txt))[:3]]})

leads.sort(key=lambda l: (-l['score'], 0 if l['dirigeant'] else 1, -(l['avis'] or 0)))
for n, l in enumerate(leads, 1): l['ordre'] = n
json.dump(leads, open('leads_cvc_brut.json', 'w'), ensure_ascii=False)
json.dump(review, open('a_relire.json', 'w'), ensure_ascii=False, indent=1)
print('exclus ensuite', dict(ex2))
print('fiches', len(leads), '· à relire', len(review), '· priorités', dict(C.Counter(l['zone'] for l in leads)),
      '· portables', sum(l['mobile'] for l in leads), '(dont site', sum(1 for l in leads if l['telGoogle']), ')',
      '· noms', dict(C.Counter(l['nomFiab'] for l in leads)), '· tailles', dict(C.Counter(l['effectif'] for l in leads)))
