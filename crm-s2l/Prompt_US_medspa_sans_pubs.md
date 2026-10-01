# Mission : 1 000 med spas en Floride et au Texas qui ne font PAS de publicité, avec le prénom du gérant et un numéro, dans un écran d'appel avec CRM

Tu travailles pour [Junior], associé de J-Square (agence qui vend de l'acquisition client aux commerces). Réponds-lui en français, simplement et sans jargon : il n'est pas développeur. Il appelle les États-Unis avec un numéro américain.

Travaille uniquement dans le dossier `medspa_sans_pubs/` (crée-le). Ce prompt est indépendant : il a sa propre clé Apify, son propre budget et ses propres fichiers. Il ne partage rien avec l'autre mission (med spas qui font des pubs).

## 1. L'offre et la cible
- Offre : on fait les publicités du med spa (Meta et Google), on crée ou refait son site, puis plus tard on ajoute un agent vocal qui rappelle chaque demande en moins d'une minute et réserve la consultation (montée en gamme).
- Cible : med spas INDÉPENDANTS (un ou deux établissements) en Floride et au Texas, qui ne font PAS de pubs. Idéal : pas de site du tout, ou un site faible, et de bons avis Google (bonne réputation mais invisibles).
- Objectif : 1 000 leads livrés. Si les crédits ne suffisent pas, dis-le à Junior avec le chiffre exact et le coût pour arriver à 1 000. Ne baisse jamais les critères sans son accord.

## 2. Collecte Google Maps avec Apify (clé n° 1, propre à cette mission)
- Au tout début, demande à Junior la clé Apify pour CETTE mission, dans un message séparé. Enregistre-la dans un fichier lisible par toi seul (chmod 600), hors du dossier du projet. Ne l'affiche jamais, ne l'écris dans aucun fichier livré, supprime-la à la fin et rappelle-lui de la régénérer si elle est passée dans le chat.
- Vérifie le crédit restant : GET https://api.apify.com/v2/users/me/limits. Annonce le coût prévu AVANT de lancer.
- Outil : `compass~crawler-google-places`. Paramètres : language "en", countryCode "us", searchStringsArray ["med spa","medical spa","aesthetic clinic"], maxCrawledPlacesPerSearch (environ 35), locationQuery "<ville>, <État>, USA". UNE seule ville par lancement.
- Laisse désactivées toutes les options payantes (scrapeContacts, scrapeSocialMediaProfiles, maximumLeadsEnrichmentRecords, reviews, images, scrapePlaceDetailPage).
- Mets maxTotalChargeUsd sur chaque lancement : le minimum accepté est 0,50 $. Coût constaté : environ 0,004 $ par fiche.
- Villes, à faire dans cet ordre jusqu'au budget :
  - Floride : Miami, Fort Lauderdale, Boca Raton, West Palm Beach, Naples, Fort Myers, Sarasota, Tampa, St. Petersburg, Orlando, Jacksonville ;
  - Texas : Houston, The Woodlands, Katy, Sugar Land, Dallas, Plano, Frisco, Fort Worth, Austin, Round Rock, San Antonio.
- Enregistre les fiches brutes dans `medspa_sans_pubs/maps_raw/<ville>.json`. Avant de lancer une ville, regarde si elle est déjà collectée, pour ne jamais payer deux fois la même.
- Le service coupe parfois les connexions : utilise une session HTTP persistante, des nouvelles tentatives et des pauses.

## 3. Tri
- Retire :
  - les établissements fermés et ceux sans téléphone ;
  - les doublons (même place_id ou même numéro) ;
  - les catégories principales Plastic surgeon, Dermatologist, Doctor, Hospital, Hair salon, Nail salon, Massage only ;
  - les chaînes et franchises : Ideal Image, LaserAway, Milan Laser, SkinSpirit, Sono Bello, Ever/Body, European Wax Center, Hand & Stone, Massage Envy, Woodhouse, The Lash Lounge, Restore Hyper Wellness, Skin Laundry, Heyday, AesthetiCare, Alchemy 43, Evolve Med Spa, Vio Med Spa, Ageless Men's Health…, plus toute enseigne présente dans au moins 3 villes ou partageant le même site web dans plusieurs villes. Attention aux mots courants (« Glow », « Skin », « Aesthetics ») : ce ne sont pas des marques.
- Garde les catégories : Medical spa, Skin care clinic, Laser hair removal service, Facial spa, Weight loss service et Day spa (ces deux dernières seulement si le nom contient med spa, aesthetic, medical, laser ou wellness).

## 4. Lecture de chaque site (gratuite, c'est le cœur du travail)
Pour chaque fiche, lis la page d'accueil et jusqu'à 5 pages internes (about, team, meet, our-story, founder, providers, staff, contact). Avec un navigateur normal ; si le site bloque ou ne répond pas, note « site à vérifier » et ne conclus pas qu'il est cassé.
- Pubs : cherche le pixel Meta (connect.facebook.net, fbevents.js, fbq('init'), la balise Google Ads (AW-, googleadservices, gtag avec AW-) et les tunnels d'agence (leadconnectorhq, msgsndr, GoHighLevel, ClickFunnels).
  - CETTE MISSION NE GARDE QUE LES MED SPAS SANS AUCUN de ces signaux.
  - Les autres sont écartés ; compte-les dans le résumé.
- Site : classe-le en
  - « No website » : pas de site, ou seulement Facebook, Instagram, Linktree, Vagaro ou Booksy ;
  - « Website to rebuild » : pas de https, pas adapté au mobile, en construction, en erreur 404/500, copyright de 2021 ou avant ;
  - « Website to improve » : pas de titre ni de description pour Google, pas de bouton d'appel ni de formulaire ;
  - « Website OK ».
  - Garde la liste des raisons pour la fiche.
- Réservation en ligne : Vagaro, Boulevard (joinblvd), Mindbody, GlossGenius, Zenoti, Mangomint, Aesthetic Record, Square, Acuity, Calendly.
- Liens réseaux sociaux trouvés SUR LEUR SITE (facebook.com/…, instagram.com/…). N'ouvre jamais Facebook ou Instagram avec un robot.
- Prénom du gérant :
  - cherche « Meet <Prénom> », « <Prénom Nom>, Owner », Founder, Co-Founder, CEO, et sinon Medical Director, Nurse Injector, NP, RN, PA-C ;
  - priorité : owner ou founder, puis medical director, puis injector principal ;
  - garde le prénom, le nom s'il est donné, le rôle et la source (« site, page About ») ;
  - ne devine jamais : en cas de doute, « Owner unknown ».

## 5. Plus de prénoms (dans cet ordre, gratuit d'abord)
- Floride : registre officiel Sunbiz (search.sunbiz.org), rubrique « Authorized Person(s) » / « Officer/Director », à petit rythme, ou les fichiers officiels de données en masse s'ils sont simples à utiliser.
- Texas : registre du Comptroller (« Taxable Entity Search », dirigeants déclarés), à petit rythme.
- N'accepte un nom que si la société correspond clairement (même nom commercial, même ville). Sinon, laisse vide.
- Option payante, SEULEMENT avec l'accord de Junior : les réponses aux avis Google signées (« Thanks! – Jessica ») via Apify, environ 0,50 $ pour 1 000 avis. Ça donne un prénom seulement.

## 6. Score et classement
- Pas de site : +3. Site à refaire : +2. Site à améliorer : +1.
- Note de 4,5 ou plus avec 20 avis ou plus : +2. Note de 4,0 ou plus avec 10 avis ou plus : +1.
- Gérant identifié : +1.
- Un seul établissement : +1.
- Tri : score décroissant. À l'intérieur d'un même score, les leads AVEC prénom passent en premier, celles sans prénom ferment la marche.

## 7. Écran d'appel + CRM (tout en anglais)
Publie un écran d'appel comme Artifact, avec une base de données partagée (capacité db). Charge d'abord les compétences « artifact-capabilities » et « artifact-design ». Stocke les leads par paquets de 50 dans une collection « lots » et les résultats d'appel dans « resultats/<id> », un document par lead. Couleurs : noir et or (change si Junior préfère).
- Onglet « Call screen » :
  - à gauche, la liste avec les filtres To call / Call back / No answer / Interested / Not interested / All (« Call back » ne montre QUE les rappels prévus, triés par date et heure ; « No answer » ne montre que les « pas de réponse », séparément), le filtre Florida/Texas et une recherche ;
  - à droite, la fiche.
- Contenu de la fiche :
  - N°, score, ville et État, et L'HEURE LOCALE DU LEAD EN DIRECT avec une pastille « good time to call » de 9 h à 18 h chez lui. Floride = heure de New York, sauf l'ouest de la Floride (Pensacola) ; Texas = heure de Chicago, sauf El Paso.
  - Le prénom du gérant en gros, et son rôle. Sinon, le nom du med spa et « Owner unknown – ask for the owner ».
  - Le téléphone au format (305) 555-0123, avec les boutons Call et Copy.
  - « Situation today » : les étoiles Google et le nombre d'avis ; le site, soit un LIEN cliquable, soit un gros « NO WEBSITE » ; l'état du site avec ses raisons ; « No ads found on their website » ; l'outil de réservation.
  - Les liens : Google Maps, Website, leur page Facebook et leur Instagram s'ils sont trouvés sur le site, et une recherche dans la bibliothèque pub Meta : https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=<nom>&search_type=keyword_unordered
  - L'ouverture : « Hi, is <Prénom> in? This is <Junior> from J-Square. »
  - Une accroche construite avec SES chiffres. Exemple : « You have 4.8 stars from 230 reviews, but no website and no ads – people searching "med spa near me" in <ville> find your competitors first. We run your ads, build your site, and send you new clients. »
  - 4 questions : How do new clients find you today? How many new clients a month, and how many would you like? Have you ever run ads? Who handles your website?
  - Rappel : appel manuel uniquement ; s'il demande à ne plus être appelé, cliquer « Do not call ».
- Boutons de résultat :
  - Interested ;
  - Demo booked ;
  - Not interested ;
  - No answer ;
  - Call back (avec date et heure) ;
  - Do not call.
- Cases « What interests them » : Ads, Website, Voice agent.
- Champs : prénom du gérant (s'il est inconnu), notes enregistrées automatiquement, historique des appels. Raccourcis clavier 1 à 6 et ← →.
- Onglet « CRM » :
  - Demos booked (grand chiffre), Called, Reached, Interested, Not interested, Left to call ;
  - un graphique des appels par jour (objectif 100) ;
  - les derniers résultats ;
  - « What interests them » ;
  - les résultats par État, puis par niveau de site ;
  - le tableau des leads à relancer ;
  - un bouton « Copy all for Google Sheets ».
- Teste la page avec de fausses données avant de publier. Après la publication, vérifie que les leads sont bien dans la base.

## 8. Règles
- Prospection entre professionnels, appels manuels uniquement : pas de numéroteur automatique, pas de message préenregistré, pas de SMS sans accord (lois TCPA et Florida FTSA).
- Respecte immédiatement les « do not call ». Appelle entre 9 h et 18 h, heure locale.
- Pas de robot sur Facebook, Instagram ou LinkedIn. Pas d'achat de fichiers. Pas d'outil payant sans l'accord de Junior.
- Uniquement des données professionnelles.
- Si un rapprochement est douteux, écris-le plutôt que de deviner.
- Tiens un fichier `medspa_sans_pubs/deja_livres.json` (place_id) pour ne jamais relivrer un lead.

## 9. Ce que tu livres
1. Le lien de l'écran d'appel.
2. Un court résumé :
   - le nombre de leads par État et par ville ;
   - le pourcentage avec prénom ;
   - la répartition No website / to rebuild / to improve / OK ;
   - le nombre de med spas écartés parce qu'ils font déjà des pubs ;
   - le coût Apify et le crédit restant sur cette clé ;
   - les limites rencontrées.
3. Si tu n'atteins pas 1 000 leads : le chiffre exact et ce qu'il faut pour y arriver.
4. Supprime le fichier de la clé et rappelle à Junior que la mission « med spas qui font des pubs » se lance avec une AUTRE clé Apify.
