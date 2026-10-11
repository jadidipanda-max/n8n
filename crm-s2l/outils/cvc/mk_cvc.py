# Construit l'écran d'appel « Chauffage-Clim » à partir de l'écran Pest Control.
t = open('pest.html', encoding='utf-8').read()

def sub(a, b, n=1):
    global t
    c = t.count(a)
    assert c == n, (a[:80], c)
    t = t.replace(a, b)

# Identité, stockage local, couleurs (bleu nuit, accent flamme)
sub('<title>Standard Pest Control</title>', '<title>Standard Chauffage-Clim</title>')
sub('<small>Zéro appel perdu</small>', '<small>Chauffage · Clim</small>')
sub('"sp-"', '"sc-"', 2)
sub('version pest control. Fond pétrole flouté, panneaux en verre dépoli, accents ambre.', 'version chauffage-climatisation. Fond bleu nuit flouté, panneaux en verre dépoli, accents flamme.')
for a, b in [('--bg: #041a1d;', '--bg: #0a1424;'), ('--surface: rgba(220, 255, 250, 0.07);', '--surface: rgba(225, 235, 255, 0.07);'),
             ('--surface-2: rgba(220, 255, 250, 0.10);', '--surface-2: rgba(225, 235, 255, 0.10);'), ('--fg: #effcf9;', '--fg: #f1f5ff;'),
             ('--muted: #a9d2ca;', '--muted: #b3c2dc;'), ('--faint: #7fa8a0;', '--faint: #8597b5;'), ('--line: rgba(200, 255, 245, 0.16);', '--line: rgba(210, 225, 255, 0.16);'),
             ('--accent: #ffc46b;', '--accent: #ff9a5c;'), ('--accent-soft: rgba(255, 196, 107, 0.16);', '--accent-soft: rgba(255, 154, 92, 0.16);'), ('--on-accent: #2a1700;', '--on-accent: #2b1000;'),
             ('rgba(16, 110, 108, 0.85) 0%, rgba(16, 110, 108, 0)', 'rgba(28, 64, 140, 0.85) 0%, rgba(28, 64, 140, 0)'),
             ('rgba(8, 72, 84, 0.9) 0%, rgba(8, 72, 84, 0)', 'rgba(14, 40, 92, 0.9) 0%, rgba(14, 40, 92, 0)'),
             ('rgba(34, 140, 118, 0.55) 0%, rgba(34, 140, 118, 0)', 'rgba(196, 84, 40, 0.42) 0%, rgba(196, 84, 40, 0)'),
             ('rgba(6, 52, 62, 0.6) 0%, rgba(6, 52, 62, 0)', 'rgba(8, 24, 56, 0.6) 0%, rgba(8, 24, 56, 0)')]:
    sub(a, b)
t = t.replace('rgba(4, 26, 29,', 'rgba(10, 20, 36,')

# Constantes métier
sub('{ k: "avis", label: "Avis Google" }, { k: "site", label: "Site / formulaire" }];', '{ k: "entretien", label: "Relance des entretiens" }, { k: "avis", label: "Avis Google" }];')
sub('"P1": "Priorité 1 (5 à 8 pts)", "P2": "Priorité 2 (3 à 4 pts)", "P3": "Priorité 3 (0 à 2 pts)"', '"P1": "Priorité 1 : taille confirmée, portable", "P2": "Priorité 2 : portable, taille à confirmer", "P3": "Priorité 3 : ligne fixe"')
sub('ZONES[l.zone] || "Priorité 3 (0 à 2 pts)"', 'ZONES[l.zone] || "Priorité 3 : ligne fixe"')

# Fiche : situation
sub("""Urgences / punaises</div><div class="v">' + (l.punaises ? "Punaises de lit" : l.urgence ? "Urgence 7j/7" : "Non affiché") + '</div></div>' +""",
    """Ce qu\\'il fait</div><div class="v">' + ([l.depannage ? "Dépannage" : "", l.entretien ? "Entretien" : "", l.installation ? "Installation" : ""].filter(Boolean).join(" · ") || "Non précisé") + ' <small>' + (l.urgence ? "urgence ou intervention rapide affichée" : "pas d\\'urgence affichée") + '</small></div></div>' +""")
sub("""Plateformes de demandes</div><div class="v">' + ((l.plateformes || []).length ? esc(l.plateformes.join(", ")) : 'Aucune <small>trouvée sur son site</small>') + '</div></div>' +""",
    """Taille (registre)</div><div class="v">' + esc(l.effectif || "Inconnue") + ' <small>' + (l.etab > 1 ? l.etab + " établissements" : l.effectif ? "plus le gérant" : "demande combien de techniciens") + '</small></div></div>' +""")
sub("""situ-card"><div class="k">Registre</div><div class="v">' + (l.creation ? "Créée en " + esc(l.creation) : "—") + ' <small>' + esc(l.effectif || "effectif inconnu") + '</small></div></div>' +""",
    """situ-card"><div class="k">Zone</div><div class="v">' + (l.multiCommunes ? "Plusieurs communes" : "Non affichée") + ' <small>' + (l.creation ? "créée en " + esc(l.creation) : "") + '</small></div></div>' +""")

# Fiche : script
sub("""<ol class="qs"><li>Quand vous êtes en intervention, qui répond au téléphone ?</li><li>Combien d\\'appels vous ratez par jour, à votre avis ?</li><li>Un client qui tombe sur votre messagerie, il rappelle ou il appelle le suivant ?</li><li>Vous payez des plateformes pour avoir des demandes ? Combien par demande ?</li></ol>""",
    """<ol class="qs"><li>Quand vous êtes chez un client ou sous une chaudière, qui répond au téléphone ?</li><li>En pleine saison de chauffe, combien d\\'appels vous ratez par jour ?</li><li>Un client sans chauffage qui tombe sur votre messagerie, il rappelle ou il appelle le suivant ?</li><li>Vos contrats d\\'entretien, vous relancez vos clients chaque année ? Comment ?</li></ol>""")
sub("""note l\\'adresse, le nuisible et l\\'urgence, propose un créneau, lui envoie un SMS de résumé tout de suite et lui transfère les urgences.""",
    """note l\\'adresse, l\\'appareil, la panne et l\\'urgence, propose un créneau, lui envoie un SMS de résumé tout de suite et lui transfère les urgences (fuite, plus de chauffage). En option : la relance des entretiens annuels.""")
sub('placeholder="Appels ratés par jour, qui répond en intervention, plateformes payées (prix par demande), objection, qui décide…"',
    'placeholder="Appels ratés par jour, qui répond en intervention, secrétaire ou pas, nombre de techniciens, contrats d’entretien, objection, qui décide…"')

sub('m.nom, "Solution-Nuisible, agence…")', 'm.nom, "Habitatpresto, agence…")')
open('cvc.html', 'w', encoding='utf-8').write(t)
print('ok', len(t))
