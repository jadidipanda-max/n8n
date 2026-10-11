# Pest control : tri, lecture des sites, registre, note ICP, fiches pour l'écran d'appel.
import json, re, time, unicodedata, collections as C, concurrent.futures as cf, requests, html as H
from urllib.parse import urlparse, urljoin

RAW = json.load(open('raw/maps.json'))
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept-Language': 'fr-FR,fr;q=0.9'}

def strip(s): return unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().lower()
def words(s): return re.sub(r'[^a-z0-9]+', ' ', strip(s)).split()

PEST = re.compile(r'nuisible|deratis|desinsect|desinfect|pest|extermin|punais|anti.?parasit|frelon|guepe|cafard|rongeur|3d\b|termit', re.I)
CHAINS = re.compile(r'rentokil|\binitial\b|anticimex|sapian|hygiene office|ecolab|isotech|hygie(?:ne)? plus|nuisibles? expert|allo nuisible|sos nuisible|depannage|dépannage', re.I)
NOT_SITE = ('facebook.', 'instagram.', 'pagesjaunes', 'google.', 'linktr', 'business.site', 'wixsite', 'solocal', 'travaux.com', 'solution-nuisible', 'starofservice', 'habitatpresto', 'allovoisins')
PLATFORMS = {'Solution-Nuisible': r'solution-nuisible', 'Travaux.com': r'travaux\.com', 'HabitatPresto': r'habitatpresto', 'StarOfService': r'starofservice', 'AlloVoisins': r'allovoisins', 'PagesJaunes': r'pagesjaunes', 'Nuisibles.fr': r'nuisibles\.fr'}
CITIES = ["Nice","Nantes","Montpellier","Strasbourg","Bordeaux","Lille","Rennes","Reims","Toulon","Saint-Étienne","Le Havre","Grenoble","Dijon","Angers","Nîmes","Clermont-Ferrand","Aix-en-Provence","Le Mans","Brest","Tours","Amiens","Limoges","Perpignan","Metz","Besançon","Orléans","Rouen","Caen","Nancy","Avignon"]

def city_of(search):
    s = strip(search)
    for c in CITIES:
        if s.endswith(strip(c)): return c
    return ''

def fmt_tel(p):
    d = re.sub(r'\D', '', p or '')
    if d.startswith('33'): d = '0' + d[2:]
    if len(d) != 10: return None
    return ' '.join(d[i:i + 2] for i in range(0, 10, 2))

# 1. Dédoublonnage et tri de base
seen, places, excl = set(), [], C.Counter()
for p in RAW:
    pid = p.get('placeId')
    if not pid or pid in seen: continue
    seen.add(pid)
    if p.get('permanentlyClosed') or p.get('temporarilyClosed'): excl['fermé'] += 1; continue
    tel = fmt_tel(p.get('phoneUnformatted') or p.get('phone'))
    if not tel: excl['sans téléphone'] += 1; continue
    cats = ' '.join([p.get('categoryName') or ''] + (p.get('categories') or []))
    if not (PEST.search(strip(cats)) or PEST.search(strip(p.get('title')))): excl['pas du métier'] += 1; continue
    if CHAINS.search(p.get('title') or '') : excl['grand groupe / réseau connu'] += 1; continue
    if (p.get('reviewsCount') or 0) == 0: excl['aucun avis Google'] += 1; continue
    p['_tel'] = tel; p['_ville_rech'] = city_of(p.get('searchString'))
    places.append(p)

# 2. Réseaux : même numéro ou même site dans plusieurs villes
def dom(u):
    if not u: return ''
    d = urlparse(u if '//' in u else 'http://' + u).netloc.lower().replace('www.', '')
    return d
byTel, byDom = C.defaultdict(set), C.defaultdict(set)
for p in places:
    byTel[p['_tel']].add(strip(p.get('city')))
    d = dom(p.get('website'))
    if d and not any(x in d for x in NOT_SITE): byDom[d].add(strip(p.get('city')))
keep = []
for p in places:
    d = dom(p.get('website'))
    if len(byTel[p['_tel']]) >= 2 or (d and len(byDom.get(d, ())) >= 3):
        excl['réseau (même numéro ou même site dans plusieurs villes)'] += 1; continue
    keep.append(p)
# doublons de numéro dans la même ville : on garde la fiche avec le plus d'avis
best = {}
for p in keep:
    k = p['_tel']
    if k not in best or (p.get('reviewsCount') or 0) > (best[k].get('reviewsCount') or 0): best[k] = p
excl['doublon de numéro'] += len(keep) - len(best)
keep = list(best.values())
print('fiches brutes', len(RAW), '· gardées', len(keep), '· exclues', dict(excl), flush=True)

# 3. Lecture des sites
URG = re.compile(r'urgence|7\s?j\s?/\s?7|7\s?jours\s?sur\s?7|24\s?h\s?/\s?24|24\s?/\s?7|intervention rapide|sous 24', re.I)
PUN = re.compile(r'punaise', re.I)
CHAT = re.compile(r'tawk\.to|crisp\.chat|tidio|intercom|livechat|zendesk|chatbot|messenger|wa\.me|whatsapp|smartsupp|chaport', re.I)
FORM = re.compile(r'<form[^>]*>(?:(?!</form>).){0,6000}?(?:type=["\'](?:email|tel)["\']|<textarea|name=["\'][^"\']*(?:mail|tel|phone|message))', re.I | re.S)
SIR = re.compile(r'(?:SIREN|SIRET|RCS|R\.C\.S\.?)[^0-9]{0,40}((?:\d[\s.]?){9})', re.I)
CRED = re.compile(r"(?:r[ée]alis[ée]|con[çc]u|cr[ée]{1,2}[ée]?|d[ée]velopp[ée])\s+(?:avec\s+\S+\s+)?(?:par|by)\s*(?:<[^>]+>\s*)*([A-Za-z0-9][^<|,\n]{1,40})", re.I)
S = requests.Session()
def get(u):
    try:
        r = S.get(u, headers=UA, timeout=12, allow_redirects=True)
        if r.status_code < 400 and 'html' in r.headers.get('content-type', ''): return r
    except Exception: return None
def site_info(p):
    u = p.get('website'); d = dom(u)
    out = {'site': u or '', 'etat': 'absent', 'raisons': [], 'urgence': False, 'punaises': False, 'plateformes': [], 'siren': None, 'credit': None}
    if not u or any(x in d for x in NOT_SITE):
        if u: out['raisons'].append('pas de vrai site (' + d + ')')
        return out
    r = get(u if '//' in u else 'http://' + u)
    if not r:
        out['etat'] = 'a_verifier'; out['raisons'].append("le site n'a pas répondu"); return out
    pages = [r.text]
    for a in re.findall(r'href=["\']([^"\']+)["\']', r.text)[:300]:
        if re.search(r'contact|mention|devis|legal', a, re.I):
            full = urljoin(r.url, a)
            if dom(full) == dom(r.url) and len(pages) < 4:
                rr = get(full)
                if rr: pages.append(rr.text)
    t = '\n'.join(pages); txt = H.unescape(re.sub(r'<[^>]+>', ' ', t))
    out['urgence'] = bool(URG.search(txt)); out['punaises'] = bool(PUN.search(txt))
    out['plateformes'] = [k for k, v in PLATFORMS.items() if re.search(v, t, re.I)]
    m = SIR.search(txt); out['siren'] = re.sub(r'\D', '', m.group(1))[:9] if m else None
    m = CRED.search(t); out['credit'] = m.group(1).strip()[:40] if m else None
    chat, form = bool(CHAT.search(t)), bool(FORM.search(t))
    if chat: out['etat'] = 'chat'; out['raisons'].append('chat ou bouton WhatsApp')
    elif form: out['etat'] = 'form'; out['raisons'].append('formulaire de contact')
    else: out['etat'] = 'sans_form'; out['raisons'].append('ni formulaire ni chat')
    if out['urgence']: out['raisons'].append("met en avant l'urgence")
    if out['plateformes']: out['raisons'].append('liens : ' + ', '.join(out['plateformes']))
    return out
with cf.ThreadPoolExecutor(16) as ex:
    for p, si in zip(keep, ex.map(site_info, keep)): p['_site'] = si
print('sites lus', flush=True)

# 4. Registre (gérant, création, effectif)
GEN = set('le la les l de du des d et en a au aux sas sarl eurl ei sasu services service deratisation desinsectisation desinfection nuisible nuisibles punaise punaises lit lits anti antinuisible antinuisibles guepe guepes frelon frelons rat rats cafard cafards traitement traitements expert experts expertise pro pros solution solutions environnement protection hygiene 3d groupe group france sud ouest est nord centre intervention interventions'.split())
EFF = {'NN': 'non renseigné', '00': '0 salarié', '01': '1-2 salariés', '02': '3-5 salariés', '03': '6-9 salariés', '11': '10-19 salariés', '12': '20-49 salariés'}
def api(params):
    for i in range(6):
        try:
            r = S.get('https://recherche-entreprises.api.gouv.fr/search', params=dict(params, per_page=10), timeout=25)
            if r.status_code == 429: time.sleep(3 + 3 * i); continue
            if r.status_code == 200: time.sleep(0.5); return r.json().get('results', [])
        except Exception: time.sleep(2 + i)
    return None
def person(r):
    for d in r.get('dirigeants', []):
        if d.get('type_dirigeant') == 'personne physique' and d.get('nom'):
            return ((d.get('prenoms') or '').split(' ')[0].title() + ' ' + d['nom'].title()).strip(), d.get('qualite') or 'Dirigeant'
    if r.get('nature_juridique') == '1000':
        return ' '.join(w.title() for w in re.sub(r'\(.*?\)', '', r.get('nom_complet') or '').split()), 'Entrepreneur individuel'
    return None, None
def reg(p):
    si = p['_site']; cp = p.get('postalCode') or ''; dep = cp[:2] if re.fullmatch(r'\d{5}', cp) else None
    if si.get('siren'):
        res = api({'q': si['siren']})
        if res: return res[0], 'n° SIREN des mentions légales'
    base = re.split(r'\s[-–|]\s|\|', p.get('title') or '')[0]
    dist = [w for w in words(base) if w not in GEN and len(w) > 1]
    if not dist: return None, 'nom trop générique'
    params = {'q': ' '.join(words(base))}
    if dep: params['departement'] = dep
    res = api(params) or []
    for r in res:
        if r.get('etat_administratif') != 'A': continue
        names = [r.get('nom_complet') or '', r.get('nom_raison_sociale') or ''] + list(((r.get('siege') or {}).get('liste_enseignes')) or [])
        if any(set(dist) <= set(words(n)) for n in names):
            ape = (r.get('activite_principale') or '')
            if ape.startswith(('81.29', '81.21', '81.22', '43.', '01.61', '74.90', '82.99')) or PEST.search(strip(' '.join(names))):
                return r, 'nom + département'
    return None, 'pas trouvé'
with cf.ThreadPoolExecutor(3) as ex:
    for p, (r, how) in zip(keep, ex.map(reg, keep)): p['_reg'] = (r, how)
print('registre interrogé', flush=True)

# 5. Note ICP et fiches
leads, ex2 = [], C.Counter()
for p in keep:
    r, how = p['_reg']; si = p['_site']
    eff = (r or {}).get('tranche_effectif_salarie')
    if eff in ('11', '12', '21', '22', '31', '32', '41', '42', '51', '52', '53'): ex2['plus de 10 salariés'] += 1; continue
    nom, qual = person(r) if r else (None, None)
    crea = (r or {}).get('date_creation') or ''
    mobile = p['_tel'].startswith(('06', '07'))
    avis = p.get('reviewsCount') or 0
    urg = si['urgence'] or bool(URG.search(p.get('title') or ''))
    pun = si['punaises'] or bool(PUN.search(' '.join([p.get('title') or '', p.get('categoryName') or ''] + (p.get('categories') or []))))
    pts, why = 0, []
    if mobile: pts += 2; why.append('Portable : il décroche lui-même (+2)')
    if 10 <= avis <= 80: pts += 2; why.append(f'{avis} avis Google : actif sans être dominant (+2)')
    if si['plateformes'] and any(x != 'PagesJaunes' for x in si['plateformes']): pts += 2; why.append('Sur une plateforme de demandes (+2)')
    if urg or pun: pts += 1; why.append(('Punaises de lit' if pun else 'Urgence') + ' mise en avant (+1)')
    if si['etat'] in ('absent', 'sans_form'): pts += 1; why.append(('Pas de site' if si['etat'] == 'absent' else 'Site sans formulaire ni chat') + ' (+1)')
    if crea[:4] in ('2020', '2021', '2022', '2023', '2024', '2025'): why.append(f'Créée en {crea[:4]} : la cible du test')
    prio = 'P1' if pts >= 5 else 'P2' if pts >= 3 else 'P3'
    ville = p.get('city') or p['_ville_rech']
    acc = ("Quand vous êtes en intervention, sous un évier ou dans un grenier, qui répond à votre téléphone ? "
           "Un client qui a des punaises ou des rats appelle le suivant s'il tombe sur la messagerie. "
           "On met en place un assistant téléphonique qui décroche quand vous ne pouvez pas, note l'adresse, le nuisible et l'urgence, "
           "et vous envoie un SMS tout de suite. Vous gardez votre numéro.")
    pid = p['placeId']
    leads.append({
        'id': 'g' + pid, 'score': pts, 'zone': prio, 'niche': p['_ville_rech'] or ville,
        'annonceur': p.get('title'), 'categorie': p.get('categoryName'),
        'dirigeant': nom, 'qualite': qual, 'entreprise': (r or {}).get('nom_complet'),
        'siren': (r or {}).get('siren'), 'urlSiren': ('https://annuaire-entreprises.data.gouv.fr/entreprise/' + r['siren']) if r and r.get('siren') else None,
        'regSource': how if r else None, 'creation': crea[:4] or None, 'effectif': EFF.get(eff, eff) if r else None,
        'ville': ville, 'cp': p.get('postalCode'), 'tel': p['_tel'], 'mobile': mobile,
        'noteGoogle': p.get('totalScore'), 'avis': avis,
        'site': si['site'], 'siteEtat': si['etat'], 'siteRaisons': si['raisons'], 'plateformes': si['plateformes'],
        'urgence': urg, 'punaises': pun, 'credit': si['credit'],
        'urlMaps': p.get('url') or ('https://www.google.com/maps/search/?api=1&query=' + requests.utils.quote(p.get('title') or '') + '&query_place_id=' + pid),
        'accroche': acc, 'pourquoi': ' · '.join(why)})
leads.sort(key=lambda l: (-l['score'], 0 if l['dirigeant'] else 1, -(l['avis'] or 0)))
for n, l in enumerate(leads, 1): l['ordre'] = n
json.dump(leads, open('leads_pest.json', 'w'), ensure_ascii=False, indent=0)
print('exclus ensuite', dict(ex2))
print('fiches', len(leads), '· priorités', dict(C.Counter(l['zone'] for l in leads)), '· avec gérant', sum(1 for l in leads if l['dirigeant']),
      '· portables', sum(1 for l in leads if l['mobile']), '· créées 2020-2025', sum(1 for l in leads if (l['creation'] or '') >= '2020'))
print('sites', dict(C.Counter(l['siteEtat'] for l in leads)), '· plateformes', dict(C.Counter(x for l in leads for x in l['plateformes'])))
print('villes', dict(C.Counter(l['niche'] for l in leads)))
