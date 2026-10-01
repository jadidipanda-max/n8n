import json,re,requests,concurrent.futures as cf
H={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36','Accept-Language':'fr-FR,fr;q=0.9'}
J=json.load(open('jobs.json'))
from pixel import CMP,BOOK,PLAT,gtm_has
def one(u):
    r={'url':u,'mode':'statique'}
    try:
        x=requests.get(u,headers=H,timeout=15,allow_redirects=True); r['status']=x.status_code; html=x.text; r['final']=x.url
    except Exception as e:
        r['erreur']=str(e)[:100]; return r
    if x.status_code>=400: return r
    # scripts externes du même site (thèmes, plugins) : on cherche aussi dedans
    low=html.lower()
    r['pixel_reseau']=False
    r['pixel_code']=bool(re.search(r"fbq\(\s*['\"]init|fbevents\.js|connect\.facebook\.net/[a-z_]+/fbevents|pixelyoursite|official-facebook-pixel|facebook-for-woocommerce|facebook_pixel_id|\"fbPixelId\"\s*:\s*\"?\d|facebookpixel|meta-pixel|\"facebook-pixel\"",html,re.I))
    r['gads']=bool(re.search(r"AW-\d{6,}|googleadservices",html))
    gtm=sorted(set(re.findall(r'GTM-[A-Z0-9]{4,9}',html))); r['gtm']=gtm
    r['cmp']=[k for k,p in CMP.items() if re.search(p,html,re.I)]
    r['cmp_fb']=bool(r['cmp'] and re.search(r"facebook.{0,40}pixel|pixel.{0,40}facebook|'facebookpixel'|facebook_pixel",low))
    if gtm and not r['pixel_code']:
        r['gtm_fb'],aw=gtm_has(gtm); r['gads']=r['gads'] or aw
    r['resa']=[k for k,p in BOOK.items() if re.search(p,html,re.I)]
    r['plateforme']=[k for k,p in PLAT.items() if re.search(p,html,re.I)][:2]
    m=re.search(r"(?:r[ée]alis[ée]|con[çc]u|d[ée]velopp[ée]|propuls[ée])\s+(?:avec\s+\S+\s+)?(?:par|by)\s*(?:<[^>]+>\s*)*([A-Za-z0-9][^<|,\n]{1,40})",html,re.I)
    r['credit']=m.group(1).strip() if m else None
    r['form']=bool(re.search(r'type=["\'](?:email|tel)["\']',html,re.I))
    return r
out={}
with cf.ThreadPoolExecutor(24) as ex:
    futs={ex.submit(lambda us:[one(u) for u in us],us):i for i,us in J.items()}
    for f in cf.as_completed(futs): out[futs[f]]=f.result()
json.dump(out,open('static_out.json','w'),ensure_ascii=False,indent=0)
import collections as C
def st(rs):
    ok=[r for r in rs if not r.get('erreur') and (r.get('status') or 0)<400]
    if not ok: return 'a_verifier'
    if any(r.get('pixel_code') or r.get('gtm_fb') or r.get('cmp_fb') for r in ok): return 'oui'
    return 'non'
print(C.Counter(st(v) for v in out.values()))
print(C.Counter(p for v in out.values() for r in v for p in (r.get('plateforme') or [])))
