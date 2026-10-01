# Construit les documents « enrich » de l'écran 1 : priorité, site, pixel Meta, agence détectée, phrase à dire.
import json, glob, os, re, collections as C
from urllib.parse import urlparse

B = '/tmp/claude-0/-home-user-n8n/d1376d6c-ae90-5e20-9a68-c762a880dacd/scratchpad/'
L = {}
for f in glob.glob(B + 'leads_live/leads/*.json'):
    d = json.load(open(f)); L[os.path.basename(f)[:-5]] = d.get('data', d)
R = {}
for f in glob.glob(B + 'res_now2/resultats/*.json'):
    d = json.load(open(f)); R[os.path.basename(f)[:-5]] = d.get('data', d)
S = json.load(open(B + 'sites_src.json'))
F = json.load(open(B + 'px/found_sites.json'))
P = json.load(open(B + 'px/pixel_merged.json')) if os.path.exists(B + 'px/pixel_merged.json') else {}

DEST = {'Formulaire Facebook': 'Formulaire Facebook', 'Renvoi vers son site': "Son site ou une page d'offre",
        'Réservation en ligne': 'Réservation en ligne', 'WhatsApp': 'WhatsApp / Messenger',
        'Page Facebook / Instagram': 'Sa page Facebook / Instagram'}
VERS_SITE = ("Son site ou une page d'offre", 'Réservation en ligne')
AGENCE_PAYEUR = {'Atoneo Agence Web', 'GENESIS TRAINING GROUP', '6AM Studio'}
NOTE_VERIF = "Vérifié automatiquement le 1er octobre. Dis « je n'ai pas trouvé », jamais « vous n'avez pas » : le pixel peut ne s'activer qu'après les cookies."

n_ce = sum(1 for v in S.values() if 'centresesthetique' in (v.get('site') or ''))

def presta(i):
    land = (S[i].get('site') or '').lower()
    if 'centresesthetique' in land:
        return "Plateforme d'agence centresesthetique(s).com", 'ce'
    pl = []
    for r in P.get(i, []): pl += r.get('plateforme') or []
    if 'leadconnectorhq' in land or 'GoHighLevel' in pl:
        return "GoHighLevel (outil utilisé par les agences)", 'ghl'
    for k, lab in (('systeme.io', 'Systeme.io (tunnel de vente)'), ('presty-digital', 'Presty Digital'), ('bookmybeauty', 'BookMyBeauty'), ('calendly', 'Calendly')):
        if k in land: return lab, 'outil'
    pay = S[i].get('payeur')
    if pay in AGENCE_PAYEUR: return 'Pubs payées par ' + pay, 'payeur'
    return '', ''

def pixel(i):
    if not F.get(i): return 'pas_de_site', ''
    rs = P.get(i)
    if rs is None: return 'a_verifier', ''
    ok = [r for r in rs if not r.get('erreur') and (r.get('status') or 0) < 400]
    if not ok: return 'a_verifier', ''
    if any(r.get('pixel_reseau') for r in ok): return 'oui', "se déclenche dès l'arrivée sur le site"
    if any(r.get('gtm_fb') for r in ok): return 'oui', 'installé via Google Tag Manager'
    if any(r.get('pixel_code') or r.get('pixel_apres_cookies') or r.get('cmp_fb') for r in ok): return 'oui', 'installé sur le site'
    return 'non', ''

def douleur(dest, px, pk, nb_ce, pr=''):
    if pk in ('outil', 'payeur') and dest in VERS_SITE:
        return ("Ses pubs envoient vers une page externe (" + pr.split(' (')[0].replace('Pubs payées par ', '') + ")",
                "Vos pubs envoient vers une page de réservation ou d'offre : quand quelqu'un laisse ses coordonnées, en combien de temps il est rappelé, et combien viennent vraiment ?",
                "La page de ses pubs n'est pas sur son site : ne parle pas du pixel de son site.", 'moyen')
    if px == 'a_verifier':
        return "Site à vérifier avant d'en parler", '', "Le site n'a pas répondu à la vérification automatique : ouvre-le avant de parler du pixel.", ''
    if pk in ('ce', 'ghl'):
        note = ("Même modèle de pub chez " + str(nb_ce) + " instituts de ta liste : c'est une agence spécialisée en esthétique. Ne la dénigre pas : parle du rappel des demandes et des no-shows."
                if pk == 'ce' else "GoHighLevel = souvent une agence avec un tunnel tout fait. Parle du rappel des demandes et des no-shows, pas du pixel.")
        return ("Ses pubs passent par une plateforme d'agence",
                "Je vois que vos pubs passent par une page d'offre d'agence. Sur 10 demandes qui arrivent, combien deviennent vraiment des clientes, et qui les rappelle, en combien de temps ?",
                note, 'moyen')
    if dest == 'Formulaire Facebook':
        base = ("Vos pubs utilisent le formulaire Facebook : Meta cherche les gens qui remplissent un formulaire le plus vite possible, pas ceux qui viennent au rendez-vous. "
                "Si personne ne lui renvoie qui est vraiment venu, il vous ramène des curieux, et c'est souvent de là que viennent les no-shows.")
        if px == 'non':
            return "Formulaire Facebook, et pas de pixel Meta trouvé sur son site", base, "En plus, je n'ai pas trouvé de pixel Meta sur son site. " + NOTE_VERIF, 'fort'
        if px == 'pas_de_site':
            return "Formulaire Facebook, pas de site trouvé", base, "Je n'ai pas trouvé de site : demande « Vous avez un site internet ? » avant d'en parler.", 'fort'
        return ("Formulaire Facebook, pixel en place",
                "Vos formulaires Facebook vous ramènent des demandes : en combien de temps chacune est rappelée, et combien viennent vraiment ? Meta ne sait pas lesquelles sont devenues des clientes, sauf si on le lui renvoie.",
                "Pixel trouvé sur son site : ne parle pas du pixel, parle du suivi des demandes.", 'moyen')
    if dest in VERS_SITE:
        if px == 'non':
            return ("Ses pubs envoient vers son site, mais pas de pixel Meta trouvé",
                    "J'ai regardé votre site : je n'y ai pas trouvé le pixel Meta. Vos pubs envoient les gens chez vous, mais Facebook ne voit pas qui réserve : il optimise pour des clics, pas pour des clientes. Vous payez des visites, pas des rendez-vous.",
                    NOTE_VERIF, 'fort')
        if px == 'oui':
            return ("Suivi Meta en place : parle du rappel des demandes",
                    "Votre suivi Meta est bien en place. La question, c'est la suite : combien de demandes deviennent des rendez-vous honorés, et en combien de temps elles sont rappelées ?",
                    '', 'ok')
        return "Le site de ses pubs n'a pas été trouvé", '', "Ouvre « Ses pubs » pour voir où elles envoient.", ''
    if dest in ('WhatsApp / Messenger', 'Sa page Facebook / Instagram'):
        return ("Ses pubs ouvrent une conversation",
                "Vos pubs ouvrent une conversation : quand quelqu'un vous écrit à 21 h ou le dimanche, qui répond, et en combien de temps ?",
                ("Pas de pixel Meta trouvé sur son site. " + NOTE_VERIF) if px == 'non' else '', 'moyen')
    if px == 'non':
        return ("Pas de pixel Meta trouvé sur son site",
                "J'ai regardé votre site : je n'y ai pas trouvé le pixel Meta. Facebook ne peut donc pas savoir qui réserve après avoir vu vos pubs.",
                NOTE_VERIF, 'fort')
    return '', '', '', ''

def tier(l):
    p = l.get('pubsActives') or 0
    if l['niche'] == 'Centres esthétiques': return (1, 'P1 · Esthétique, petit annonceur') if p <= 5 else (2, 'P2 · Esthétique, gros annonceur')
    if l['niche'] == 'Agences immobilières': return 3, 'P3 · Immobilier'
    return 4, 'P4 · Cuisinistes / traiteurs'

items = {}
for i, l in L.items():
    x = S[i]; dest = DEST.get(x.get('mode') or '', '')
    land = (x.get('site') or '').strip('/')
    pr, pk = presta(i)
    px, pxd = pixel(i)
    t, tl = tier(l)
    titre, say, note, niv = douleur(dest, px, pk, n_ce, pr)
    e = {'prioLabel': tl, 'pixel': px}
    f = F.get(i)
    if f: e['site'] = f['url']; e['siteDomaine'] = f['domaine']
    if pxd: e['pixelDetail'] = pxd
    if dest: e['destination'] = dest
    if land and dest in VERS_SITE + ('Formulaire Facebook',) and (not f or land.replace('www.', '') not in f['domaine']): e['landing'] = land
    if pr: e['prestaDetecte'] = pr
    rs = [r for r in P.get(i, []) if not r.get('erreur')]
    if rs:
        e['gads'] = any(r.get('gads') for r in rs)
        resa = sorted({k for r in rs for k in (r.get('resa') or [])})
        if resa: e['resa'] = ', '.join(resa)
        pl = [p for r in rs for p in (r.get('plateforme') or []) if p not in ('Hostinger', 'GoDaddy')]
        if pl: e['plateforme'] = pl[0]
        cr = next((r.get('credit') for r in rs if r.get('credit')), None)
        if cr and len(cr) < 40: e['credit'] = re.sub(r'\s+', ' ', cr).strip(' .')
    if titre: e['douleurTitre'] = titre
    if say: e['douleur'] = say
    if note: e['douleurNote'] = note
    if niv: e['douleurNiveau'] = niv
    called = bool((R.get(i) or {}).get('historique'))
    named = bool(l.get('dirigeant') or (R.get(i) or {}).get('gerant'))
    e['_k'] = (1 if called else 0, t, 0 if named else 1, (0 if (niv == 'fort' and px == 'non') else {'fort': 1, 'moyen': 2}.get(niv, 3)), l.get('ordre') or 999)
    items[i] = e

for n, i in enumerate(sorted(items, key=lambda k: items[k]['_k']), 1):
    items[i]['ordre'] = n
for e in items.values(): del e['_k']

ids = sorted(items, key=lambda k: items[k]['ordre'])
half = len(ids) // 2
os.makedirs(B + 'px/enrich', exist_ok=True)
for name, part in (('e1', ids[:half]), ('e2', ids[half:])):
    doc = {'items': {i: items[i] for i in part}, 'maj': '2026-10-01'}
    s = json.dumps(doc, ensure_ascii=False)
    open(B + 'px/enrich/' + name + '.json', 'w').write(s)
    print(name, len(part), len(s.encode()), 'octets')

# Résumé
rem = [i for i in ids if not (R.get(i) or {}).get('historique')]
print('restantes', len(rem))
print('tiers restants', C.Counter(items[i]['prioLabel'] for i in rem))
print('pixel restants', C.Counter(items[i]['pixel'] for i in rem))
print('pixel tous', C.Counter(items[i]['pixel'] for i in ids))
print('douleur restants', C.Counter(items[i].get('douleurNiveau', '-') for i in rem))
print('dest x pixel restants', C.Counter((items[i].get('destination', '-'), items[i]['pixel']) for i in rem).most_common())
print('presta', C.Counter(items[i].get('prestaDetecte', '-') for i in ids).most_common())
print('top 12:')
for i in ids[:12]: print(items[i]['ordre'], L[i]['annonceur'], '|', items[i]['prioLabel'], '|', items[i]['pixel'], '|', items[i].get('douleurTitre'))
