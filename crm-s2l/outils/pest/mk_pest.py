# Construit l'écran d'appel « Pest control » à partir de l'écran Acquisition.
import re
t = open('acquisition.html', encoding='utf-8').read()

def sub(a, b, n=1):
    global t
    c = t.count(a)
    assert c == n, (a[:80], c)
    t = t.replace(a, b)

# Identité, stockage local, couleurs (verre pétrole, accent ambre)
sub('<title>Standard Acquisition</title>', '<title>Standard Pest Control</title>')
sub('<div class="brand">J-Square <small>Acquisition</small></div>', '<div class="brand">J-Square <small>Zéro appel perdu</small></div>')
sub('localStorage.getItem("sa-" + k)', 'localStorage.getItem("sp-" + k)')
sub('localStorage.setItem("sa-" + k', 'localStorage.setItem("sp-" + k')
sub('/* Mise en page : standard téléphonique, version acquisition. Un seul univers : fond bordeaux flouté, panneaux en verre dépoli, accents champagne. */',
    '/* Mise en page : standard téléphonique, version pest control. Fond pétrole flouté, panneaux en verre dépoli, accents ambre. */')
for a, b in [('--bg: #22070e;', '--bg: #041a1d;'), ('--surface: rgba(255, 232, 238, 0.07);', '--surface: rgba(220, 255, 250, 0.07);'),
             ('--surface-2: rgba(255, 232, 238, 0.10);', '--surface-2: rgba(220, 255, 250, 0.10);'), ('--fg: #fdf2f4;', '--fg: #effcf9;'),
             ('--muted: #ddb6c0;', '--muted: #a9d2ca;'), ('--faint: #b48e98;', '--faint: #7fa8a0;'), ('--line: rgba(255, 214, 224, 0.16);', '--line: rgba(200, 255, 245, 0.16);'),
             ('--accent: #f0cf9e;', '--accent: #ffc46b;'), ('--accent-soft: rgba(240, 207, 158, 0.16);', '--accent-soft: rgba(255, 196, 107, 0.16);'), ('--on-accent: #3a0b15;', '--on-accent: #2a1700;'),
             ('rgba(150, 30, 62, 0.85) 0%, rgba(150, 30, 62, 0)', 'rgba(16, 110, 108, 0.85) 0%, rgba(16, 110, 108, 0)'),
             ('rgba(110, 16, 44, 0.9) 0%, rgba(110, 16, 44, 0)', 'rgba(8, 72, 84, 0.9) 0%, rgba(8, 72, 84, 0)'),
             ('rgba(176, 58, 84, 0.55) 0%, rgba(176, 58, 84, 0)', 'rgba(34, 140, 118, 0.55) 0%, rgba(34, 140, 118, 0)'),
             ('rgba(92, 12, 34, 0.6) 0%, rgba(92, 12, 34, 0)', 'rgba(6, 52, 62, 0.6) 0%, rgba(6, 52, 62, 0)')]:
    sub(a, b)
t = t.replace('rgba(34, 7, 14,', 'rgba(4, 26, 29,')  # barre du haut éventuelle
sub('.sb-correct { background: var(--st-int-soft); color: var(--st-int); }',
    '.sb-correct { background: var(--st-int-soft); color: var(--st-int); }\n.sb-sans_form { background: var(--st-rap-soft); color: var(--st-rap); }\n.sb-form, .sb-chat { background: var(--st-int-soft); color: var(--st-int); }\n.hookbox { border-left: 3px solid var(--st-rap); padding-left: 12px; font-size: 16px; line-height: 1.55; }')

# Constantes métier
sub('  var SITE_LBL = { absent: "Pas de vrai site", a_refaire: "Site à refaire", moyen: "Site à améliorer", a_verifier: "Site à vérifier", correct: "Site correct" };',
    '  var SITE_LBL = { absent: "Pas de site", sans_form: "Site sans formulaire ni chat", form: "Site avec formulaire", chat: "Site avec chat / WhatsApp", a_verifier: "Site à vérifier" };')
sub('  var INTERETS = [{ k: "pubs", label: "Publicités" }, { k: "site", label: "Site internet" }, { k: "reseaux", label: "Réseaux sociaux" }, { k: "seo", label: "Référencement Google" }, { k: "tri", label: "Tri des demandes" }];',
    '  var INTERETS = [{ k: "assistant", label: "Assistant qui décroche" }, { k: "sms", label: "SMS de résumé" }, { k: "agenda", label: "Prise de RDV" }, { k: "urgence", label: "Transfert des urgences" }, { k: "avis", label: "Avis Google" }, { k: "site", label: "Site / formulaire" }];')
sub('  var ZONES = { "93": "Seine-Saint-Denis", "IDF": "Île-de-France (hors 93)", "FR": "Reste de la France" };',
    '  var ZONES = { "P1": "Priorité 1 (5 à 8 pts)", "P2": "Priorité 2 (3 à 4 pts)", "P3": "Priorité 3 (0 à 2 pts)" };')
sub('var zk = ZONES[l.zone] || "Reste de la France";', 'var zk = ZONES[l.zone] || "Priorité 3 (0 à 2 pts)";')

# Liste : filtres « villes » et « priorités »
sub('<select class="field" id="niche" aria-label="Niche"><option value="">Toutes les niches</option>', '<select class="field" id="niche" aria-label="Ville"><option value="">Toutes les villes</option>')
sub('<select class="field" id="zone" aria-label="Zone"><option value="">Toutes les zones</option>', '<select class="field" id="zone" aria-label="Priorité"><option value="">Toutes les priorités</option>')
sub('"Toutes les leads ont été appelées. Passe sur « À rappeler » puis « Pas de réponse »."', '"Premier passage terminé. Passe sur « Pas de réponse » : ceux qui étaient sur messagerie sont tes meilleures cibles."')

# Fiche : en-tête
sub("(l.cp ? \" (\" + esc(String(l.cp).slice(0, 2)) + \")\" : \"\") + '</span>' + (l.zone === \"93\" ? '<span class=\"tag hot\">Seine-Saint-Denis · démo sur place</span>' : l.zone === \"IDF\" ? '<span class=\"tag\">Île-de-France</span>' : \"\")",
    "(l.cp ? \" (\" + esc(String(l.cp).slice(0, 2)) + \")\" : \"\") + '</span>' + '<span class=\"tag' + (l.zone === \"P1\" ? \" hot\" : \"\") + '\">' + esc(ZONES[l.zone] || \"\") + '</span>' + (l.creation ? '<span class=\"tag\">Créée en ' + esc(l.creation) + '</span>' : \"\")")
sub("<span class=\"tag\">' + esc(l.niche) + '</span><span>' + esc(l.ville", "<span>' + esc(l.ville")

# Fiche : situation
start = t.index("        '<div class=\"situ-card\"><div class=\"k\">Avis Google</div>")
end = t.index("      '</div><div class=\"links\">' + links.join(\"\") + \"</div></div>\" +")
t = t[:start] + r"""        '<div class="situ-card"><div class="k">Avis Google</div><div class="v">' + stars + ' <small>' + (l.avis || 0) + ' avis</small></div></div>' +
        '<div class="situ-card"><div class="k">Son numéro</div><div class="v">' + (l.mobile ? "Portable" : "Ligne fixe") + ' <small>' + (l.mobile ? "il décroche lui-même" : "standard ou fixe") + '</small></div></div>' +
        '<div class="situ-card"><div class="k">Site internet</div><div class="v"><span class="sb sb-' + esc(l.siteEtat || "absent") + '">' + esc(SITE_LBL[l.siteEtat] || "Pas de site") + "</span></div>" + (raisons.length ? '<ul class="reasons">' + raisons.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") + "</div>" +
        '<div class="situ-card"><div class="k">Urgences / punaises</div><div class="v">' + (l.punaises ? "Punaises de lit" : l.urgence ? "Urgence 7j/7" : "Non affiché") + '</div></div>' +
        '<div class="situ-card"><div class="k">Plateformes de demandes</div><div class="v">' + ((l.plateformes || []).length ? esc(l.plateformes.join(", ")) : 'Aucune <small>trouvée sur son site</small>') + '</div></div>' +
        '<div class="situ-card"><div class="k">Registre</div><div class="v">' + (l.creation ? "Créée en " + esc(l.creation) : "—") + ' <small>' + esc(l.effectif || "effectif inconnu") + '</small></div></div>' +
""" + t[end:]

# Fiche : script
sub("        '<div><div class=\"lbl\">Accroche</div><div class=\"hook\">' + esc(l.accroche || \"\") + \"</div></div>\" +",
    "        (hist(l.id).some(function (e) { return e.s === \"no_rep\"; }) ? '<div><div class=\"lbl\">Il était sur messagerie : commence par ça</div><div class=\"hookbox\">« Je vous ai appelé tout à l\\'heure et je suis tombé sur votre messagerie. C\\'est exactement ce que je règle : combien de clients tombent sur votre répondeur chaque semaine ? »</div></div>' : \"\") +\n"
    "        '<div><div class=\"lbl\">Accroche</div><div class=\"hook\">' + esc(l.accroche || \"\") + \"</div></div>\" +")
sub("<ol class=\"qs\"><li>Aujourd\\'hui, comment vos nouveaux clients vous trouvent-ils ?</li><li>Combien de nouveaux clients par mois ? Et combien vous en voudriez ?</li><li>Vous avez déjà fait de la pub ? Qui s\\'occupe de votre site et de vos réseaux ?</li><li>Si on vous envoie des demandes déjà triées, vous les rappelez dans la journée ?</li></ol>",
    "<ol class=\"qs\"><li>Quand vous êtes en intervention, qui répond au téléphone ?</li><li>Combien d\\'appels vous ratez par jour, à votre avis ?</li><li>Un client qui tombe sur votre messagerie, il rappelle ou il appelle le suivant ?</li><li>Vous payez des plateformes pour avoir des demandes ? Combien par demande ?</li></ol>")
sub("'<div class=\"deliver\"><b>Ce qu\\'on lui livre :</b> des demandes de clients déjà triées dans son CRM (' + esc(LIVRE[l.niche] || \"projet, budget, délai\") + '), c\\'est lui qui rappelle.</div>'",
    "'<div class=\"deliver\"><b>Ce qu\\'on lui livre :</b> un assistant téléphonique qui décroche quand il ne peut pas (il garde son numéro), note l\\'adresse, le nuisible et l\\'urgence, propose un créneau, lui envoie un SMS de résumé tout de suite et lui transfère les urgences. L\\'assistant se présente comme assistant.</div>'")
sub("'<div class=\"legal\">À dire dès le début : ses coordonnées viennent de sa fiche Google et du registre des entreprises ; il peut refuser d\\'être rappelé (dans ce cas : « Pas intéressé »).</div>'",
    "'<div class=\"legal\">À dire dès le début : ses coordonnées viennent de sa fiche Google et du registre des entreprises ; il peut refuser d\\'être rappelé (dans ce cas : « Pas intéressé »). Ne dis pas « IA » : dis « assistant téléphonique ».</div>'")
sub('placeholder="Comment il trouve ses clients, nombre de clients par mois, budget pub, objection, qui décide…"',
    'placeholder="Appels ratés par jour, qui répond en intervention, plateformes payées (prix par demande), objection, qui décide…"')

# CRM : intitulés
sub('tableGroup("Par zone", "Où ça répond le mieux", s.parZone)', 'tableGroup("Par priorité", "La note de priorité prédit-elle les réponses ?", s.parZone)')
sub("'<div class=\"panel\"><h3>Par niche</h3><div class=\"sub\">Quelle niche répond et signe le mieux</div><div class=\"tablewrap\"><table><thead><tr><th>Niche</th>",
    "'<div class=\"panel\"><h3>Par ville</h3><div class=\"sub\">Quelle ville répond et signe le mieux</div><div class=\"tablewrap\"><table><thead><tr><th>Ville</th>")
t = t.replace('var head = ["N°", "Score", "Niche", "Commerce", "Gérant", "Téléphone", "Ville", "Zone",', 'var head = ["N°", "Score", "Ville de recherche", "Entreprise", "Gérant", "Téléphone", "Ville", "Priorité",')

# Vérification : fiabilité du nom, source du numéro, points d'attention
sub('.hookbox { border-left', '.attn { margin-top: 10px; font-size: 13px; line-height: 1.5; color: var(--st-rap); }\n.hookbox { border-left')
sub('  var SITE_LBL = { absent: "Pas de site"', '  var NOMF = { sur: "nom sûr, vérifié sur son site", probable: "nom probable (registre : nom + département)", a_confirmer: "nom à confirmer : commence par « Je suis bien chez… ? »", site: "nom affiché sur son propre site" };\n  var SITE_LBL = { absent: "Pas de site"')
sub("""esc(!l.dirigeant ? "Nom noté pendant l'appel" : (l.qualite || "")) + '</div><div class="biz">'""",
    """esc(!l.dirigeant ? "Nom noté pendant l'appel" : (l.qualite || "") + (NOMF[l.nomFiab] ? " · " + NOMF[l.nomFiab] : "")) + '</div><div class="biz">'""")
sub("""(l.ville ? " <span>· " + esc(l.ville) + "</span>" : "") + "</div></div>" +""",
    """(l.ville ? " <span>· " + esc(l.ville) + "</span>" : "") + "</div>" + ((l.attention || []).length ? '<div class="attn">⚠ ' + l.attention.map(esc).join(" · ") + "</div>" : "") + "</div>" +""")
sub("""<div class="src">Fiche Google · ' + (l.mobile ? "portable" : "ligne fixe") + (l.entreprise""",
    """<div class="src">' + esc(l.telSource || "Fiche Google") + (l.telGoogle ? " · fixe de la fiche Google : " + esc(l.telGoogle) : " · " + (l.mobile ? "portable" : "ligne fixe")) + (l.entreprise""")
sub("""(l.mobile ? "il décroche lui-même" : "standard ou fixe")""", """(l.telGoogle ? "trouvé sur son site" : l.mobile ? "il décroche lui-même" : "standard ou fixe")""")
sub('"Gérant", "Téléphone", "Ville", "Priorité",', '"Gérant", "Fiabilité du nom", "Téléphone", "Source du numéro", "Ville", "Priorité",')
sub('l.annonceur, nomGerant(l), l.tel, l.ville || "",', 'l.annonceur, nomGerant(l), NOMF[l.nomFiab] || "", l.tel, l.telSource || "Fiche Google", l.ville || "",')

# Étude de marché adaptée au pest control (mêmes champs, libellés du métier)
sub('<span class="mkl">Qui gère ses pubs ?</span>', '<span class="mkl">Qui lui apporte des clients (pubs, plateformes) ?</span>')
sub('f("frais", "Frais de gestion de son agence (€/mois)"', 'f("frais", "Ce qu\'il paie à ce prestataire (€/mois)"')
sub('f("nom", "Nom de l\'agence ou du freelance", "text", m.nom, "Agence Untel…")', 'f("nom", "Nom du prestataire ou de la plateforme", "text", m.nom, "Solution-Nuisible, agence…")')
t = t.replace('"Qui gère ses pubs", "Prestataire", "Avec ce prestataire depuis", "Frais de gestion €/mois"', '"Qui lui apporte des clients", "Prestataire", "Avec ce prestataire depuis", "Payé au prestataire €/mois"')
t = t.replace('<th>Qui gère ses pubs</th>', '<th>Qui lui apporte des clients</th>')

open('pest.html', 'w', encoding='utf-8').write(t)
print('ok', len(t))
