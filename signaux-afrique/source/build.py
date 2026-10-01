import json, uuid, os, sys
JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'js')
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
NS = uuid.UUID('6b1f1f5e-6a4e-4f55-9a4e-2f1c3a0d7e11')

def js(name):
    return open(os.path.join(JS, name)).read().rstrip() + '\n'

def node(wf, name, typ, ver, pos, params, **extra):
    n = {'parameters': params, 'id': str(uuid.uuid5(NS, wf + '/' + name)), 'name': name,
         'type': typ, 'typeVersion': ver, 'position': pos}
    n.update(extra)
    return n

def code(wf, name, pos, f, **extra):
    return node(wf, name, 'n8n-nodes-base.code', 2, pos, {'jsCode': js(f)}, **extra)

def sheet_rl(expr):
    return {'__rl': True, 'mode': 'url', 'value': expr}

def sheets(wf, name, pos, onglet, op, cle=None):
    params = {
        'operation': op,
        'documentId': sheet_rl("={{ $('Paramètres').first().json.googleSheetUrl }}"),
        'sheetName': {'__rl': True, 'mode': 'name', 'value': onglet},
        'columns': {'mappingMode': 'autoMapInputData', 'value': {},
                    'matchingColumns': [cle] if cle else [], 'schema': []},
        'options': {},
    }
    return node(wf, name, 'n8n-nodes-base.googleSheets', 4.5, pos, params)

def gmail(wf, name, pos):
    return node(wf, name, 'n8n-nodes-base.gmail', 2.1, pos, {
        'sendTo': "={{ $('Paramètres').first().json.email }}",
        'subject': '={{ $json.sujet }}',
        'emailType': 'html',
        'message': '={{ $json.html }}',
        'options': {'appendAttribution': False},
    })

def link(conns, a, b, out=0, inp=0):
    outs = conns.setdefault(a, {'main': []})['main']
    while len(outs) <= out:
        outs.append([])
    outs[out].append({'node': b, 'type': 'main', 'index': inp})

def note(wf, name, pos, text, w=380, h=260, color=None):
    p = {'content': text, 'height': h, 'width': w}
    if color: p['color'] = color
    return node(wf, name, 'n8n-nodes-base.stickyNote', 1, pos, p)

RETRY = {'retryOnFail': True, 'maxTries': 5, 'waitBetweenTries': 5000, 'onError': 'continueRegularOutput'}
SETTINGS = {'executionOrder': 'v1', 'timezone': 'Africa/Douala', 'saveManualExecutions': True}

def workflow(name, nodes, conns, tags):
    return {'name': name, 'nodes': nodes, 'connections': conns, 'pinData': {}, 'settings': SETTINGS,
            'active': False, 'meta': {'templateCredsSetupCompleted': False}, 'tags': []}

# ---------------------------------------------------------------- 1. Radar mensuel
w = 'radar'
n = [
    note(w, 'Mode d’emploi', [-40, -360],
         "## Radar 1 : opportunités d'import / export\n"
         "Chaque 1er du mois, ce workflow regarde ce que **le Cameroun, ses voisins et de grands marchés achètent à l'étranger** "
         "(chiffres officiels des douanes, ONU Comtrade), calcule un **score de 0 à 100** pour chaque couple pays + produit, "
         "range tout dans Google Sheets et t'envoie par email les 15 meilleures pistes avec **qui les fournit aujourd'hui**.\n\n"
         "**À faire une fois :**\n1. Ouvre le nœud **Paramètres** : ton email, l'adresse de ta Google Sheet, tes produits et leur statut.\n"
         "2. Choisis ton compte Google dans les 2 nœuds Google Sheets et dans le nœud Gmail.\n"
         "3. Clique sur **Execute workflow** pour tester, puis active le workflow.", w=560, h=300),
    node(w, 'Lancer à la main', 'n8n-nodes-base.manualTrigger', 1, [0, 0], {}),
    node(w, 'Chaque 1er du mois', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 200],
         {'rule': {'interval': [{'field': 'months', 'triggerAtDayOfMonth': 1, 'triggerAtHour': 6}]}}),
    code(w, 'Paramètres', [240, 100], 'w1_parametres.js'),
    code(w, 'Préparer les requêtes', [460, 100], 'w1_requetes.js'),
    node(w, 'Comtrade : importations', 'n8n-nodes-base.httpRequest', 4.2, [680, 100],
         {'url': '={{ $json.url }}', 'options': {'batching': {'batch': {'batchSize': 1, 'batchInterval': 3000}}, 'timeout': 60000}}, **RETRY),
    code(w, 'Calculer les scores', [900, 100], 'w1_scores.js'),
    sheets(w, 'Google Sheets : toutes les opportunités', [1120, -40], 'Opportunites', 'appendOrUpdate', 'cle'),
    code(w, 'Top N', [1120, 200], 'w1_top.js'),
    code(w, 'Préparer les requêtes fournisseurs', [1340, 200], 'w1_req_fournisseurs.js'),
    node(w, 'Comtrade : qui fournit ?', 'n8n-nodes-base.httpRequest', 4.2, [1560, 200],
         {'url': '={{ $json.url }}',
          'options': {'batching': {'batch': {'batchSize': 1, 'batchInterval': 3000}}, 'timeout': 60000}}, **RETRY),
    node(w, 'Comtrade : noms des pays', 'n8n-nodes-base.httpRequest', 4.2, [1780, 200],
         {'url': 'https://comtradeapi.un.org/files/v1/app/reference/partnerAreas.json', 'options': {}},
         executeOnce=True, retryOnFail=True, maxTries=3, waitBetweenTries=5000, onError='continueRegularOutput'),
    code(w, 'Analyser les fournisseurs', [2000, 200], 'w1_fournisseurs.js'),
    sheets(w, 'Google Sheets : détails du top', [2220, 60], 'Opportunites', 'appendOrUpdate', 'cle'),
    code(w, "Préparer l'email", [2220, 260], 'w1_email.js'),
    gmail(w, 'Envoyer le résumé', [2440, 260]),
]
c = {}
link(c, 'Lancer à la main', 'Paramètres'); link(c, 'Chaque 1er du mois', 'Paramètres')
link(c, 'Paramètres', 'Préparer les requêtes'); link(c, 'Préparer les requêtes', 'Comtrade : importations')
link(c, 'Comtrade : importations', 'Calculer les scores')
link(c, 'Calculer les scores', 'Google Sheets : toutes les opportunités'); link(c, 'Calculer les scores', 'Top N')
link(c, 'Top N', 'Préparer les requêtes fournisseurs'); link(c, 'Préparer les requêtes fournisseurs', 'Comtrade : qui fournit ?'); link(c, 'Comtrade : qui fournit ?', 'Comtrade : noms des pays')
link(c, 'Comtrade : noms des pays', 'Analyser les fournisseurs')
link(c, 'Analyser les fournisseurs', 'Google Sheets : détails du top'); link(c, 'Analyser les fournisseurs', "Préparer l'email")
link(c, "Préparer l'email", 'Envoyer le résumé')
json.dump(workflow('Radar 1 : opportunités import-export (ONU Comtrade)', n, c, []),
          open(os.path.join(OUT, '1-radar-opportunites.json'), 'w'), ensure_ascii=False, indent=2)

# ---------------------------------------------------------------- 2. Veille quotidienne
w = 'veille'
n = [
    note(w, 'Mode d’emploi', [-40, -380],
         "## Radar 2 : veille quotidienne\n"
         "Chaque matin à 7 h, ce workflow récupère :\n- les **appels d'offres** de la Banque mondiale en Afrique (fournitures agricoles, semences, vivres…), avec **l'acheteur et son contact** ;\n"
         "- les **actualités** Google sur les pénuries, interdictions d'export, importations et exportations agricoles.\n\n"
         "Il ne garde que ce qui parle de tes produits, ignore ce qu'il a déjà vu, range tout dans l'onglet **Signaux** et t'envoie un email s'il y a du nouveau.\n\n"
         "**À faire une fois :** remplis le nœud **Paramètres**, choisis ton compte Google dans les nœuds Google Sheets et Gmail, puis active le workflow. "
         "(La mémoire « déjà vu » ne fonctionne que quand le workflow est activé, pas pendant les tests.)", w=600, h=320),
    node(w, 'Lancer à la main', 'n8n-nodes-base.manualTrigger', 1, [0, 0], {}),
    node(w, 'Chaque matin à 7 h', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 200],
         {'rule': {'interval': [{'field': 'days', 'triggerAtHour': 7}]}}),
    code(w, 'Paramètres', [240, 100], 'w2_parametres.js'),
    node(w, "Banque mondiale : appels d'offres", 'n8n-nodes-base.httpRequest', 4.2, [480, -20], {
        'url': 'https://search.worldbank.org/api/v2/procnotices',
        'sendQuery': True,
        'queryParameters': {'parameters': [
            {'name': 'format', 'value': 'json'},
            {'name': 'rows', 'value': '100'},
            {'name': 'srt', 'value': 'submission_date'},
            {'name': 'order', 'value': 'desc'},
            {'name': 'notice_type_exact', 'value': 'Invitation for Bids'},
            {'name': 'procurement_group_exact', 'value': 'GO'},
            {'name': 'project_ctry_name_exact', 'value': "={{ $json.paysAppelsOffres.join('^') }}"},
        ]},
        'options': {'timeout': 60000},
    }, **RETRY),
    code(w, "Mettre en forme : appels d'offres", [720, -20], 'w2_ao.js'),
    code(w, 'Préparer les recherches', [480, 220], 'w2_urls.js'),
    node(w, 'Google Actualités', 'n8n-nodes-base.rssFeedRead', 1.1, [720, 220], {'url': '={{ $json.url }}', 'options': {}},
         onError='continueRegularOutput'),
    code(w, 'Mettre en forme : actualités', [940, 220], 'w2_actus.js'),
    node(w, 'Rassembler', 'n8n-nodes-base.merge', 3, [1160, 100], {}),
    code(w, 'Garder les nouveaux signaux', [1380, 100], 'w2_filtre.js'),
    sheets(w, 'Google Sheets : Signaux', [1600, 0], 'Signaux', 'append'),
    code(w, "Préparer l'email", [1600, 200], 'w2_email.js'),
    gmail(w, "Envoyer l'alerte", [1820, 200]),
]
c = {}
link(c, 'Lancer à la main', 'Paramètres'); link(c, 'Chaque matin à 7 h', 'Paramètres')
link(c, 'Paramètres', "Banque mondiale : appels d'offres"); link(c, 'Paramètres', 'Préparer les recherches')
link(c, "Banque mondiale : appels d'offres", "Mettre en forme : appels d'offres")
link(c, "Mettre en forme : appels d'offres", 'Rassembler', inp=0)
link(c, 'Préparer les recherches', 'Google Actualités'); link(c, 'Google Actualités', 'Mettre en forme : actualités')
link(c, 'Mettre en forme : actualités', 'Rassembler', inp=1)
link(c, 'Rassembler', 'Garder les nouveaux signaux')
link(c, 'Garder les nouveaux signaux', 'Google Sheets : Signaux'); link(c, 'Garder les nouveaux signaux', "Préparer l'email")
link(c, "Préparer l'email", "Envoyer l'alerte")
json.dump(workflow("Radar 2 : veille quotidienne (appels d'offres et actualités)", n, c, []),
          open(os.path.join(OUT, '2-veille-quotidienne.json'), 'w'), ensure_ascii=False, indent=2)

# ---------------------------------------------------------------- 3. Leads B2B par email
w = 'leads'
n = [
    note(w, 'Mode d’emploi', [-40, -340],
         "## Radar 3 : leads B2B reçus par email\n"
         "Inscris-toi (gratuitement) sur des plateformes B2B comme Go4WorldBusiness, Tridge, TradeKey, ExportHub ou EC21 et active leurs **alertes email** "
         "sur tes produits. Ce workflow lit ces emails toutes les heures et crée une **fiche contact** dans l'onglet **Contacts** : acheteur ou vendeur, produits, pays, quantité, "
         "coordonnées, et une alerte si l'email ressemble à une arnaque (frais d'inscription, Western Union…).\n\n"
         "**À faire une fois :** dans Gmail, crée un libellé **leads-b2b** et un filtre qui y range ces emails ; choisis ton compte Google dans les nœuds ; "
         "colle l'adresse de ta Google Sheet dans le nœud Google Sheets ; active le workflow.", w=600, h=300),
    node(w, 'Nouvel email de plateforme B2B', 'n8n-nodes-base.gmailTrigger', 1.2, [0, 100], {
        'pollTimes': {'item': [{'mode': 'everyHour'}]},
        'simple': False,
        'filters': {'q': 'label:leads-b2b OR from:(go4worldbusiness.com OR tridge.com OR tradekey.com OR exporthub.com OR ec21.com OR tradewheel.com)',
                    'readStatus': 'both'},
        'options': {},
    }),
    code(w, 'Lire le lead', [240, 100], 'w3_lead.js'),
    node(w, 'Google Sheets : Contacts', 'n8n-nodes-base.googleSheets', 4.5, [480, 100], {
        'operation': 'append',
        'documentId': sheet_rl('https://docs.google.com/spreadsheets/d/COLLE_ICI_L_ID_DE_TA_FEUILLE/edit'),
        'sheetName': {'__rl': True, 'mode': 'name', 'value': 'Contacts'},
        'columns': {'mappingMode': 'autoMapInputData', 'value': {}, 'matchingColumns': [], 'schema': []},
        'options': {},
    }),
]
c = {}
link(c, 'Nouvel email de plateforme B2B', 'Lire le lead'); link(c, 'Lire le lead', 'Google Sheets : Contacts')
json.dump(workflow('Radar 3 : leads B2B reçus par email', n, c, []),
          open(os.path.join(OUT, '3-leads-b2b-email.json'), 'w'), ensure_ascii=False, indent=2)
print('ok')
