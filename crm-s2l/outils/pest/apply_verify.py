# Applique la vérification : exclut franchises, réseaux, groupes et lignes de standard ; ajoute le portable
# publié sur le site ; retire les noms « non diffusibles » ; ajoute la fiabilité du nom. Relu à la main avant.
import json, os, re, collections as C
from urllib.parse import urlparse

L = json.load(open('leads_pest.json')); V = {r['id']: r for r in json.load(open('verify.json'))}
REG = json.load(open('reg_check.json'))
FIX = json.load(open('corrections_manuelles.json')) if os.path.exists('corrections_manuelles.json') else {}
def dom(u): return urlparse(u if '//' in (u or '') else 'http://' + (u or '')).netloc.lower().replace('www.', '')

EXCL = [  # (motif sur le nom ou le site, raison)
    (r'eden\s?vert', 'Franchise Eden Vert 3D (réseau national)'),
    (r'sanipure', 'Réseau Sanipure (siège à Lyon, présent dans plusieurs villes)'),
    (r'avipur', 'Réseau national Avipur (36 agences)'),
    (r'pestaly', 'Franchise Pestaly (plus de 40 agences)'),
    (r'\belis\b', 'Groupe Elis'),
    (r'\bngan\b', 'Réseau NGAN'),
    (r'farago', 'Franchise Farago'),
    (r'tous les nuisibles|lecongelo', 'Franchise Tous les Nuisibles / Le Congélo Thermique'),
    (r'^doc pest', 'Tête de réseau de franchise (Doc Pest)'),
    (r'quanttum', 'Entreprise à plusieurs agences (même numéro sur deux fiches)'),
    (r'guepe eclair|guêpe éclair|neoxial', 'Réseau national Guêpe Éclair'),
    (r'stopguepesfrelons\.fr', 'Intervenant du réseau Stop Guêpes et Frelons'),
    (r'paraxilocentre', '3 agences, détenue par le groupe Pest Control Partnership'),
    (r"g[ée]n[ée]rale d.hygi[eè]ne", '6 agences en Auvergne-Rhône-Alpes'),
    (r'strehl-family', 'Groupe Strehl (11 agences)'),
    (r'abaipro', 'Filiale du groupe Rentokil'),
    (r'techmo', 'Groupe Techmo Hygiène (7 agences)'),
    (r'service-anti-nuisibles\.fr', 'Nombreuses agences dans le Sud'),
    (r'eco-flair', '7 équipes dans toute la France'),
    (r'saded', 'Réseau SADED France'),
    (r'kedalis', '3 agences (Besançon, Annecy, Nice)'),
    (r'dome hygiene', '3 agences'),
    (r'aegis 3d', '3 agences'),
    (r'antiparasitaire-bretagne', 'Plusieurs agences avec leurs propres techniciens'),
    (r'ads-assainissement', 'Plusieurs agences (assainissement)'),
    (r'ins-bretagne', 'Entreprise de nettoyage à plusieurs agences'),
    (r'assistance3d\.fr', '4 agences et 4 établissements'),
    (r'ats3d|atouts-services3d', '3 agences'),
    (r'^centre anti nuisibles$', "Fiche d'une agence ATS3D (même numéro)"),
    (r'alpes3d', 'Plusieurs agences en Rhône-Alpes'),
    (r'nhgroup', 'Groupe présent sur deux régions'),
    (r'phobi', '4 établissements, siège à Laval'),
    (r'rsp-services', '7 établissements au registre'),
    (r'zeropunaisedelit', '6 établissements au registre'),
    (r'hygi[eè]ne pr[ée]vention environnement 3d', "Agence d'une entreprise basée à Gentilly (3 établissements)"),
    (r'agf-abeilles', 'SAS à 3 établissements, 668 avis'),
    (r'labrigadeantinuisibles', 'Numéro parisien de centre d’appel pour une fiche près de Rennes'),
    (r'\sbordeaux\.fr$', 'Service de la mairie de Bordeaux'),
    (r'rovira-nettoyage', 'Même numéro que « Le dératiseur catalan » : doublon'),
    (r"^noma'gasin", 'Même gérant que Noma-2D : doublon'),
    (r'traitement-punaises-de-lit-paris\.paris|traitementpunaisesdelitparis\.fr', 'Numéro de standard parisien (01 8x) et nom de fiche en mots-clés : probable centre d’appel'),
]
AGENCY = re.compile(r'h[ée]berg|hostinger|\bovh\b|ionos|kelmedia|r[ée]alis[ée] par|conception|agence web|webmaster|d[ée]velopp|cr[ée]ation du site|design', re.I)
FREEMAIL = ('gmail.', 'hotmail.', 'orange.', 'free.', 'outlook.', 'yahoo.', 'laposte.', 'wanadoo.', 'sfr.', 'icloud.', 'live.')

keep, excl = [], C.Counter(); exclList = []
for l in L:
    key = (l['annonceur'] or '') + ' ' + dom(l.get('site'))
    why = next((w for p, w in EXCL if re.search(p, key, re.I)), None)
    if why: excl[why] += 1; exclList.append((l['annonceur'], l['ville'], why)); continue
    v = V.get(l['id'], {})
    # Registre « non diffusible » : on n'affiche aucun nom venant du registre
    if 'diffusible' in (l.get('dirigeant') or '').lower():
        l['dirigeant'] = None; l['qualite'] = None; l['entreprise'] = None; l['nonDiffusible'] = True
    # Corrections relues à la main (fichier local, jamais dans le dépôt : il contient des noms de gérants)
    fix = FIX.get(l['annonceur'])
    if fix: l.update(fix.get('lead', {})); v.update(fix.get('verif', {}))
    # Nom publié par le gérant lui-même sur son site, quand le registre n'en donne pas
    if not l.get('dirigeant') and v.get('nomSite'):
        nm = ' '.join(v['nomSite'].split()[:2]).title()
        l['dirigeant'] = nm; l['qualite'] = 'Responsable du site'; l['regSource'] = 'mentions légales de son site'; v['nomFiab'] = 'site'
    l['nomFiab'] = v.get('nomFiab') if l.get('dirigeant') else None
    # Portable publié sur son propre site quand la fiche Google donne un fixe
    if v.get('mobileSite') and not l['mobile']:
        ok = True
        s = json.load(open(f"sites/{l['id']}.json")); t = ' '.join(p['text'] for p in s['pages'])
        d = re.sub(r'\D', '', v['mobileSite']); m = re.search(r'(?:\+33\s?|0)' + d[1] + r'[\s.\-]?' + r'[\s.\-]?'.join([d[i:i + 2] for i in range(2, 10, 2)]), t)
        if m:
            before, after = t[max(0, m.start() - 220):m.start()], t[m.end():m.end() + 80]
            mail = re.search(r'[\w.+-]+@([\w-]+\.[\w.]+)', after)
            if AGENCY.search(before) and not re.search(r'directeur|directrice|responsable|g[ée]rant', before[-120:], re.I): ok = False
            if mail and not mail.group(1).lower().startswith(FREEMAIL) and dom(l.get('site')).split('.')[-2] not in mail.group(1).lower(): ok = False
        if ok:
            l['telGoogle'] = l['tel']; l['tel'] = v['mobileSite']; l['mobile'] = True
            l['telSource'] = 'Portable affiché sur son site (' + (v.get('mobileSiteOu') or 'site') + ')'
            l['score'] += 2; l['pourquoi'] = ' · '.join(x for x in ['Portable sur son site : il décroche lui-même (+2)', l.get('pourquoi')] if x)
        else: excl_note = True
    l.setdefault('telSource', 'Fiche Google')
    # Points d'attention gardés sur la fiche
    att = []
    r = REG.get(l.get('siren') or '') or {}
    if (r.get('etab') or 0) == 2: att.append('2 établissements au registre')
    if (r.get('etab') or 0) >= 3: att.append(f"{r['etab']} établissements au registre (entrepreneur individuel)")
    if l['annonceur'].startswith('3D Propreté'): att.append('2 agences (Narbonne, Montpellier)')
    if l['annonceur'].startswith('HTE SANITATION'): att.append('Membre du réseau Prosane : vérifie qui décide')
    if l.get('nonDiffusible'):
        att.append("Au registre, il a demandé que son nom ne soit pas diffusé : le nom affiché vient de son propre site" if l.get('nomFiab') == 'site'
                   else "Au registre, il a demandé que son nom ne soit pas diffusé : demande le gérant sans citer de nom")
    l['attention'] = att
    l['zone'] = 'P1' if l['score'] >= 5 else 'P2' if l['score'] >= 3 else 'P3'
    keep.append(l)

keep.sort(key=lambda l: (-l['score'], 0 if l['dirigeant'] else 1, -(l['avis'] or 0)))
for i, l in enumerate(keep, 1): l['ordre'] = i
json.dump(keep, open('leads_pest.json', 'w'), ensure_ascii=False)
json.dump(exclList, open('exclus_verif.json', 'w'), ensure_ascii=False, indent=0)
print('exclus', sum(excl.values()), '· gardés', len(keep))
for w, n in excl.most_common(): print(f'  {n:2} {w}')
print('priorités', C.Counter(l['zone'] for l in keep), '· portables', sum(l['mobile'] for l in keep), '· dont portable trouvé sur le site', sum(1 for l in keep if l.get('telGoogle')))
print('noms', C.Counter(l.get('nomFiab') for l in keep), '· non diffusibles', sum(1 for l in keep if l.get('nonDiffusible')))
