# Relit le site de chaque lead (accueil, contact, mentions légales, à propos, agences) et garde le texte en cache.
import json, os, re, sys, html as H, concurrent.futures as cf, requests
from urllib.parse import urlparse, urljoin

L = json.load(open('leads_pest.json'))
os.makedirs('sites', exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept-Language': 'fr-FR,fr;q=0.9'}
NOT_SITE = ('facebook.', 'instagram.', 'pagesjaunes', 'google.', 'linktr', 'business.site', 'wixsite', 'solocal', 'travaux.com', 'solution-nuisible', 'starofservice', 'habitatpresto', 'allovoisins')
KEY = re.compile(r'contact|mention|legal|l[ée]gal|propos|qui-sommes|qui_sommes|societe|entreprise|equipe|agence|implantation|franchise|devenir|zone|intervention|cgv|conditions', re.I)
S = requests.Session()

def dom(u): return urlparse(u if '//' in u else 'http://' + u).netloc.lower().replace('www.', '')
def get(u):
    try:
        r = S.get(u, headers=UA, timeout=12, allow_redirects=True)
        if r.status_code < 400 and 'html' in r.headers.get('content-type', ''): return r
    except Exception: return None
def text(h):
    h = re.sub(r'(?is)<(script|style|noscript)[^>]*>.*?</\1>', ' ', h)
    return re.sub(r'\s+', ' ', H.unescape(re.sub(r'<[^>]+>', ' ', h))).strip()

def crawl(l):
    out = f"sites/{l['id']}.json"
    if os.path.exists(out): return 'cache'
    u = l.get('site') or ''
    if not u or any(x in dom(u) for x in NOT_SITE): return 'sans site'
    r = get(u if '//' in u else 'http://' + u)
    if not r: json.dump({'ok': False}, open(out, 'w')); return 'ko'
    base = dom(r.url); pages = [(r.url, r.text)]; seen = {r.url.rstrip('/')}
    links = []
    for a in re.findall(r'href=["\']([^"\'#]+)["\']', r.text):
        f = urljoin(r.url, a)
        if dom(f) == base and KEY.search(urlparse(f).path) and f.rstrip('/') not in seen:
            seen.add(f.rstrip('/')); links.append(f)
    for f in links[:7]:
        rr = get(f)
        if rr: pages.append((rr.url, rr.text))
    data = {'ok': True, 'pages': [{'url': pu, 'text': text(ph)[:60000],
                                   'tels': re.findall(r'href=["\']tel:([^"\']+)', ph, re.I),
                                   'hosts': sorted({dom(x) for x in re.findall(r'href=["\'](https?://[^"\']+)', ph)} - {base})[:60]} for pu, ph in pages]}
    json.dump(data, open(out, 'w'), ensure_ascii=False)
    return 'ok'

todo = [l for l in L if l.get('site')]
res = {}
with cf.ThreadPoolExecutor(16) as ex:
    for i, r in enumerate(ex.map(crawl, todo)):
        res[r] = res.get(r, 0) + 1
        if i % 50 == 0: print(i, res, flush=True)
print('fin', res, flush=True)
