import json,re,unicodedata,concurrent.futures as cf,requests,html,sys
from urllib.parse import urlparse
S=json.load(open('../sites_src.json'))
L={}
import glob,os
for f in glob.glob('../leads_live/leads/*.json'):
    d=json.load(open(f)); L[os.path.basename(f)[:-5]]=d.get('data',d)
SHARED=('centresesthetique','leadconnectorhq','calendly.com','reservation-en-ligne','typeform','facebook.com','instagram.com','planity','treatwell','wa.me','linktr','bit.ly','urlr.me','kalendes','presty-digital','bookmybeauty','systeme.io','itiaki','creneaufacile','monplanrenov','google.','forms.gle','jotform','tally.so','fb.me','msgsndr','uni-immobilier','laserostop','iadfrance','safti','capifrance','megagence','proprietes-privees','optimhome','efficity','bsk','lafourchette','mariages.net','zankyou')
STOP=set('le la les de du des et l d un une en au aux by chez the and of a sur votre vos nos mon ma'.split())
GEN=set('institut beaute beauty esthetique esthetic esthetics centre center spa immobilier immo agence conseiller conseillere consultant cuisine cuisines cuisiniste traiteur paris france soins soin bien etre laser studio maison salon epilation minceur care'.split())
H={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36','Accept-Language':'fr-FR,fr;q=0.9'}
def strip(s): return ''.join(c for c in unicodedata.normalize('NFD',s or '') if unicodedata.category(c)!='Mn').lower()
def toks(s): return [t for t in re.split(r'[^a-z0-9]+',strip(s)) if t]
def cands(i):
    v=S[i]; l=L[i]; out=[]
    for src in [v.get('site')]+re.findall(r'\b((?:[\w-]+\.)+(?:fr|com|net|eu|paris|io|beauty|immo))\b',(v.get('extrait') or '').lower()):
        if not src: continue
        d=src.lower().strip('/').split('/')[0]
        if any(x in d for x in SHARED): continue
        out.append(('pub',d))
        p=d.split('.')
        if len(p)>2 and p[0] not in ('www',): out.append(('pub-racine','.'.join(p[1:])))
    for nm in [l.get('annonceur'),l.get('entreprise')]:
        t=[x for x in toks(nm) if x not in STOP]
        if not t: continue
        core=[x for x in t if x not in GEN]
        vs=set()
        vs.add(''.join(t)); vs.add('-'.join(t))
        if core: vs.add(''.join(core)); vs.add('-'.join(core))
        if len(t)>2: vs.add(''.join(t[:2])); vs.add('-'.join(t[:2]))
        for x in list(vs):
            if 3<=len(x)<=40:
                for tld in ('fr','com'): out.append(('devine',x+'.'+tld))
    seen=set(); res=[]
    for k,d in out:
        if d in seen: continue
        seen.add(d); res.append((k,d))
    return res[:14]
def phones(l):
    d=re.sub(r'\D','',l.get('tel') or '')
    return d[-9:] if len(d)>=9 else None
def fetch(d):
    for u in ('https://'+d+'/','https://www.'+d+'/'):
        try:
            r=requests.get(u,headers=H,timeout=9,allow_redirects=True)
            if r.status_code<400 and 'html' in r.headers.get('content-type','') and len(r.text)>500: return r
        except Exception: pass
    return None
def check(i):
    l=L[i]; ph=phones(l); vil=strip(l.get('ville') or ''); best=None
    core=[x for x in toks(l.get('annonceur')) if x not in STOP and x not in GEN and len(x)>2]
    for k,d in cands(i):
        r=fetch(d)
        if not r: continue
        t=r.text; tx=strip(html.unescape(re.sub(r'<[^>]+>',' ',t)))
        digits=re.sub(r'\D','',re.sub(r'\+33\s*\(0\)\s*','0',t))
        okph= bool(ph and (ph in digits or ph in re.sub(r'\D','',tx)))
        okv= bool(vil and vil.split('-')[0] in tx)
        okn= bool(core and all(c in tx for c in core[:2]))
        dom=urlparse(r.url).netloc.replace('www.','')
        if any(x in dom for x in SHARED): continue
        conf=None
        if k.startswith('pub'): conf='pub'+('+tel' if okph else '')
        elif okph: conf='tel'
        elif okn and okv: conf='nom+ville'
        if conf:
            best={'url':r.url,'domaine':dom,'preuve':conf,'source':k}
            if k.startswith('pub') or okph: break
    return i,best
if __name__=='__main__':
    ids=sys.argv[1:] or list(L)
    out={}
    with cf.ThreadPoolExecutor(24) as ex:
        for n,(i,b) in enumerate(ex.map(check,ids)):
            out[i]=b
            if n%25==0: print(n,flush=True)
    json.dump(out,open('found_sites.json','w'),ensure_ascii=False,indent=1)
    print('found',sum(1 for v in out.values() if v),'of',len(out))
