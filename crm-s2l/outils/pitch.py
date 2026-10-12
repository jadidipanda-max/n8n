# Pitchs d'appel par niche (source : offre-s2l/pain-points-pitchs.md), injectés dans les écrans par mk_pest.py et mk_cvc.py.
import json, re

PEST = {
    "accroche": "Quand vous êtes dans des combles ou chez un client avec vos gants, qui répond à votre téléphone ? Et la personne qui découvre des punaises à 22 h, ou un nid de frelons au-dessus de sa terrasse : si elle tombe sur votre messagerie, elle rappelle ou elle appelle le suivant ?",
    "questions": ["Combien d'appels vous ratez par jour, à votre avis ?",
                  "En ce moment, avec les rongeurs qui rentrent dans les maisons, c'est pire ?",
                  "Un chantier punaises, ça vous rapporte combien en moyenne ?"],
    "proposition": "On installe un assistant téléphonique qui décroche quand vous ne pouvez pas. Vous gardez votre numéro. Il se présente comme votre assistant, demande le nuisible, l'adresse, le type de logement et l'urgence, propose un créneau et vous envoie un SMS de résumé tout de suite. Les vraies urgences vous sont transférées. Ceux qui veulent juste un prix reçoivent une fourchette et un rendez-vous de diagnostic.",
    "calcul": "« Si vous ratez 3 appels par jour et qu'un seul est un chantier punaises, ça fait combien par mois ? » Laisse-le faire le calcul.",
    "repondeur": "« Je vous ai appelé tout à l'heure et je suis tombé sur votre messagerie, exactement comme vos clients quand vous êtes en intervention. C'est ce que je règle : combien de clients tombent sur votre répondeur chaque semaine ? »",
    "message": "« Bonjour, Jay de J-Square. Je vous ai appelé et je suis tombé sur votre messagerie, exactement comme vos clients quand vous êtes en intervention. C'est ce que je règle. Je vous rappelle [jour] à [heure]. »",
    "objections": [
        ["Je rappelle toujours mes clients.", "Le soir, oui. Mais celui qui avait des punaises à 14 h a déjà appelé quelqu'un d'autre à 14 h 05. L'assistant ne vous remplace pas : il prend le rendez-vous pendant que vous travaillez."],
        ["Les clients n'aiment pas parler à une machine.", "Ils aiment encore moins la messagerie. L'assistant se présente clairement, ne fait pas attendre et vous envoie tout par SMS : vous rappelez qui vous voulez."],
        ["J'ai une secrétaire.", "Parfait. Et entre 12 h et 14 h, après 18 h et le samedi ? L'assistant prend le relais quand elle n'est pas là."],
        ["Pas le temps de mettre ça en place.", "C'est nous qui installons tout : un simple renvoi d'appel quand vous ne décrochez pas. Rien à changer de votre côté."],
        ["C'est combien ?", "Moins qu'un chantier par mois. Je vous montre d'abord que ça marche avec vos appels, et on parle du prix à la démo."]],
}

CVC = {
    "accroche": "La saison de chauffe commence. Quand vous êtes sous une chaudière ou sur un chantier, qui répond à votre téléphone ? Et le client qui n'a plus de chauffage un dimanche soir : s'il tombe sur la messagerie, il attend lundi ou il appelle le suivant ?",
    "questions": ["Combien d'appels vous ratez par jour en ce moment ?",
                  "Vous décrochez les numéros que vous ne connaissez pas, avec tout le démarchage ?",
                  "Vos contrats d'entretien, vous les relancez comment chaque année ?"],
    "proposition": "On installe un assistant téléphonique qui décroche quand vous ne pouvez pas. Vous gardez votre numéro. Il se présente comme votre assistant et note l'adresse, la marque de l'appareil, le code d'erreur et l'urgence : vous arrivez avec la bonne pièce. Il propose un créneau, vous envoie un SMS de résumé et vous transfère les vraies urgences (fuite, plus de chauffage avec des enfants ou une personne âgée). En option, il relance vos clients pour l'entretien annuel.",
    "calcul": "« Un dépannage, c'est combien chez vous ? Et un contrat d'entretien sur plusieurs années ? Si l'assistant en récupère deux par semaine… » Laisse-le faire le calcul.",
    "repondeur": "« Je vous ai appelé tout à l'heure et je suis tombé sur votre messagerie, comme vos clients quand vous êtes sous une chaudière. C'est justement ce que je règle : combien d'appels tombent sur votre répondeur chaque semaine ? »",
    "message": "« Bonjour, Jay de J-Square. Je suis tombé sur votre messagerie, comme vos clients quand vous êtes sous une chaudière. C'est justement ce que je règle. Je vous rappelle [jour] à [heure]. »",
    "objections": [
        ["J'ai une secrétaire.", "Elle est là le midi, le soir et le samedi ? L'assistant prend le relais quand elle n'est pas disponible, et il lui prépare les rendez-vous."],
        ["Mes clients me connaissent, ils rappellent.", "Les anciens, oui. Les nouveaux qui ont trouvé votre fiche Google en pleine panne, non : ils appellent le suivant."],
        ["Pas le temps de mettre ça en place.", "C'est nous qui le faisons : un renvoi d'appel quand vous ne décrochez pas, rien à changer de votre côté."],
        ["Les gens raccrochent face à une machine.", "Moins que face à une messagerie pleine. Il se présente honnêtement, va droit au but et vous envoie tout par SMS."],
        ["C'est combien ?", "Moins qu'un dépannage par mois. Je vous montre d'abord que ça marche avec vos appels, et on parle du prix à la démo."]],
}

def js(p): return '  /* PITCH */ var PITCH = ' + json.dumps(p, ensure_ascii=False).replace('</', '<\\/') + '; /* /PITCH */\n'

CSS = """.obj { font-size: 14px; line-height: 1.55; }
.obj summary { cursor: pointer; font-weight: 700; color: var(--accent); font-size: 13px; }
.obj dl { margin: 10px 0 0; display: grid; gap: 8px; }
.obj dt { font-weight: 600; }
.obj dd { margin: 2px 0 0; color: var(--muted); }
.obj p { margin: 10px 0 0; color: var(--muted); }
"""

# Bloc « script » de la fiche, construit à partir de PITCH
SCRIPT = r"""      '<div class="sheet-sec script">' +
        '<div><div class="lbl">Ouverture</div><div class="ask">' + (nm ? "« Bonjour, <b>" + esc(nm) + "</b> ? Jay, de J-Square. " : "« Bonjour, je suis bien avec le gérant ou la gérante de <b>" + esc(court) + "</b> ? Jay, de J-Square. ") + "J\'ai vu votre fiche Google" + (l.avis ? ", " + l.avis + " avis, c\'est du sérieux" : "") + ". Vos coordonnées viennent de cette fiche et du registre des entreprises : si vous ne voulez pas que je vous rappelle, dites-le-moi. Vous avez 30 secondes ? »</div></div>" +
        (hist(l.id).some(function (e) { return e.s === "no_rep"; }) ? '<div><div class="lbl">Il était sur messagerie : commence par ça</div><div class="hookbox">' + esc(PITCH.repondeur) + "</div></div>" : "") +
        '<div><div class="lbl">Accroche</div><div class="hook">« ' + esc(PITCH.accroche) + " »</div></div>" +
        '<div><div class="lbl">Questions à poser</div><ol class="qs">' + PITCH.questions.map(function (q) { return "<li>" + esc(q) + "</li>"; }).join("") + "</ol></div>" +
        '<div><div class="lbl">Ce qu\'on lui propose</div><div class="deliver">' + esc(PITCH.proposition) + "</div></div>" +
        '<div><div class="lbl">Fais-lui calculer</div><div class="ask">' + esc(PITCH.calcul) + "</div></div>" +
        '<div><div class="lbl">Fermeture : objectif rendez-vous de démo</div><div class="ask">« Le plus simple, c\'est que vous l\'entendiez répondre au nom de <b>' + esc(court) + "</b>. Je vous le montre en 15 minutes : demain ou jeudi ? »</div></div>" +
        '<details class="obj"><summary>Objections et message de répondeur</summary><dl>' + PITCH.objections.map(function (o) { return "<dt>« " + esc(o[0]) + " »</dt><dd>" + esc(o[1]) + "</dd>"; }).join("") + "</dl><p><b>S\'il ne répond pas, laisse ce message :</b> " + esc(PITCH.message) + "</p></details>" +
        (why.length ? '<div><div class="lbl">Pourquoi c\'est une bonne cible</div><div class="why">' + why.map(function (w) { return "<span>" + esc(w) + "</span>"; }).join("") + "</div></div>" : "") +
        '<div class="legal">Ne dis jamais « IA » : dis « assistant téléphonique ». Ne cite aucun chiffre de vendeur : fais-lui calculer ses propres pertes. S\'il refuse d\'être rappelé : « Pas intéressé ».</div>' +
"""

def inject(t, p):
    """Remplace le bloc script de la fiche et ajoute PITCH + styles. t vient de mk_pest.py (avant pitch)."""
    a = t.index("      '<div class=\"sheet-sec script\">' +\n")
    b = t.index("'<div class=\"legal\">", a); b = t.index('\n', b) + 1
    t = t[:a] + SCRIPT + t[b:]
    # nom court de l'entreprise pour l'ouverture et la fermeture
    k = t.index('    var stars = l.noteGoogle')
    t = t[:k] + '    var court = String(l.annonceur || "").split(/\\s[-–|]\\s|\\s\\(|\\|/)[0].slice(0, 40);\n' + t[k:]
    k = t.index('  var INTERETS = ')
    t = t[:k] + js(p) + t[k:]
    k = t.index('.hookbox {')
    t = t[:k] + CSS + t[k:]
    return t

def swap(t, p):
    """Remplace le PITCH d'un écran déjà injecté (utilisé par mk_cvc.py)."""
    n = len(re.findall(r'  /\* PITCH \*/ .*? /\* /PITCH \*/\n', t))
    assert n == 1, n
    return re.sub(r'  /\* PITCH \*/ .*? /\* /PITCH \*/\n', lambda m: js(p), t)
