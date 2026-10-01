import asyncio,json,re,sys,requests
from urllib.parse import urlparse
from playwright.async_api import async_playwright
CHROME=[p for p in __import__('glob').glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')][0]
H={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'}
CMP={'axeptio':r'axept','tarteaucitron':r'tarteaucitron','didomi':r'didomi','cookiebot':r'cookiebot','onetrust':r'onetrust|cookielaw','complianz':r'complianz|cmplz','cookieyes':r'cookieyes|cky-','iubenda':r'iubenda','sirdata':r'sirdata','borlabs':r'borlabs','wix':r'wix-cookie|consentPolicy'}
BOOK={'Planity':r'planity','Treatwell':r'treatwell','Kalendes':r'kalendes','Booksy':r'booksy','Calendly':r'calendly','Fresha':r'fresha','BookMyBeauty':r'bookmybeauty','Presty':r'presty','Wizi':r'wizi\.','Reservio':r'reservio','SimplyBook':r'simplybook','Setmore':r'setmore','Doctolib':r'doctolib','Crénolibre':r'crenolibre','Agenda en ligne':r'rdv360|clicrdv|resalib'}
PLAT={'Wix':r'wixstatic|wix\.com','WordPress':r'wp-content|wp-includes','Shopify':r'cdn\.shopify','Squarespace':r'squarespace','Systeme.io':r'systeme\.io','GoHighLevel':r'leadconnectorhq|msgsndr|highlevel','Webflow':r'webflow','Jimdo':r'jimdo','Site123':r'site123','Presty':r'presty-digital','Wizi':r'mywizi','GoDaddy':r'godaddy|secureserver','Hostinger':r'hostinger|zyrosite','Weebly':r'weebly','Duda':r'dudaone|multiscreensite'}
def gtm_has(ids):
    fb=aw=False
    for g in ids[:3]:
        try:
            t=requests.get('https://www.googletagmanager.com/gtm.js?id='+g,headers=H,timeout=10).text
            if re.search(r'fbevents|connect\.facebook\.net|fbq\(|__fbq',t): fb=True
            if re.search(r'AW-\d{6,}|googleadservices|"vtp_conversionId"|awct',t): aw=True
        except Exception: pass
    return fb,aw
async def one(ctx,url):
    reqs=[]; pg=await ctx.new_page(); pg.on('request',lambda r: reqs.append(r.url))
    r={'url':url}
    try:
        resp=await pg.goto(url,wait_until='commit',timeout=30000)
        r['status']=resp.status if resp else None
        try: await pg.wait_for_load_state('domcontentloaded',timeout=25000)
        except Exception: pass
        try: await pg.wait_for_load_state('networkidle',timeout=6000)
        except Exception: pass
        await pg.wait_for_timeout(2000)
        html=await pg.content(); r['final']=pg.url
        n0=len(reqs); r['consent_clic']=False
        for sel in ['.cky-btn-accept','#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll','#CybotCookiebotDialogBodyButtonAccept','#axeptio_btn_acceptAll','#tarteaucitronPersonalize2','#tarteaucitronAllAllowed','#didomi-notice-agree-button','.cmplz-accept','#onetrust-accept-btn-handler','.iubenda-cs-accept-btn','#cookie_action_close_header','#wt-cli-accept-all-btn']:
            try:
                loc=pg.locator(sel).first
                if await loc.count() and await loc.is_visible():
                    await loc.click(timeout=3000); r['consent_clic']=True; break
            except Exception: pass
        for lab in ([] if r['consent_clic'] else [r"Tout accepter",r"Accepter tout",r"Accepter et fermer",r"J'accepte",r"Accepter",r"Accept all",r"Accept",r"OK pour moi",r"Autoriser",r"J’accepte"]):
            try:
                btn=pg.locator('button, a, [role=button]',has_text=re.compile(r'^\s*'+lab,re.I)).first
                if await btn.count() and await btn.is_visible():
                    await btn.click(timeout=3000); r['consent_clic']=True; break
            except Exception: pass
        if r['consent_clic']:
            await pg.wait_for_timeout(4000)
            try: html=html+await pg.content()
            except Exception: pass
        r['pixel_apres_cookies']=bool(re.search(r'connect\.facebook\.net/.+fbevents|facebook\.com/tr[/?]',' '.join(reqs[n0:])))
    except Exception as e:
        r['erreur']=str(e)[:120]; await pg.close(); return r
    try: await pg.close()
    except Exception: pass
    allreq=' '.join(reqs); low=html.lower()
    r['pixel_reseau']=bool(re.search(r'connect\.facebook\.net/.+fbevents|facebook\.com/tr[/?]',allreq))
    r['pixel_code']=bool(re.search(r"fbq\(\s*['\"]init|fbevents\.js|pixelyoursite|official-facebook-pixel|facebook-for-woocommerce|facebook_pixel_id|fbpixel|facebookpixel|meta-pixel",html,re.I))
    r['gads']=bool(re.search(r'googleadservices\.com/pagead|googleads\.g\.doubleclick|/pagead/conversion',allreq) or re.search(r"AW-\d{6,}",html))
    gtm=sorted(set(re.findall(r'GTM-[A-Z0-9]{4,9}',html+allreq))); r['gtm']=gtm
    r['ga4']=bool(re.search(r'G-[A-Z0-9]{6,}',html+allreq) and re.search(r'gtag|google-analytics|googletagmanager',html+allreq))
    r['cmp']=[k for k,p in CMP.items() if re.search(p,html+allreq,re.I)]
    r['cmp_fb']=bool(r['cmp'] and re.search(r"facebook.{0,40}pixel|pixel.{0,40}facebook|'facebookpixel'|facebook_pixel|\"facebook\"",low))
    if gtm and not r['pixel_reseau']:
        r['gtm_fb'],r['gtm_aw']=gtm_has(gtm)
        if r['gtm_aw']: r['gads']=True
    r['resa']=[k for k,p in BOOK.items() if re.search(p,html,re.I)]
    r['plateforme']=[k for k,p in PLAT.items() if re.search(p,html+allreq,re.I)][:2]
    r['form']=bool(re.search(r'<form[^>]*>(?:(?!</form>).){0,4000}?(type=["\'](?:email|tel)["\']|name=["\'][^"\']*(?:mail|tel|phone))',html,re.I|re.S))
    m=re.search(r"(?:r[ée]alis[ée]|con[çc]u|cr[ée]{1,2}[ée]?|design[ée]?|d[ée]velopp[ée])\s+(?:avec\s+(?:❤|amour)\s+)?(?:par|by)\s*(?:<[^>]+>\s*)*([A-Za-z0-9][^<|,\n]{1,40})",html,re.I)
    r['credit']=m.group(1).strip() if m else None
    r['whatsapp']=bool(re.search(r'wa\.me|api\.whatsapp',html))
    r['title']=(re.search(r'<title[^>]*>(.*?)</title>',html,re.S|re.I).group(1).strip()[:90] if re.search(r'<title',html,re.I) else '')
    return r
async def main(jobs,out):
    import os
    res=json.load(open(out)) if os.path.exists(out) else {}
    jobs={k:v for k,v in jobs.items() if k not in res}
    async with async_playwright() as p:
        import os
        px=os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
        b=await p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'],proxy={'server':px} if px else None)
        sem=asyncio.Semaphore(10)
        async def run(i,urls):
            async with sem:
                ctx=await b.new_context(user_agent=H['User-Agent'],locale='fr-FR',ignore_https_errors=True)
                rr=[]
                for u in urls:
                    x=await one(ctx,u)
                    if x.get('erreur') or (x.get('status') or 0)>=500:
                        await asyncio.sleep(3); x=await one(ctx,u)
                    rr.append(x)
                await ctx.close(); res[i]=rr
                print(len(res),flush=True)
                if len(res)%10==0: json.dump(res,open(out,'w'),ensure_ascii=False)
        await asyncio.gather(*[run(i,u) for i,u in jobs.items()])
        await b.close()
    json.dump(res,open(out,'w'),ensure_ascii=False,indent=1)
if __name__=='__main__':
    jobs=json.load(open(sys.argv[1])); asyncio.run(main(jobs,sys.argv[2]))
