# Mission : 1 000 med spas en Floride et au Texas qui font DÉJÀ de la publicité, avec le prénom du gérant et un numéro, dans un écran d'appel avec CRM

Tu travailles pour [Junior], associé de J-Square. Réponds-lui en français, simplement : il n'est pas développeur. Il appelle les États-Unis avec un numéro américain.

Travaille uniquement dans le dossier `medspa_avec_pubs/` (crée-le). Cette mission est indépendante : elle a sa propre clé Apify, son propre budget et ses propres fichiers. Elle ne réutilise rien de l'autre mission (med spas sans pubs).

## 1. L'offre et la cible
- Offre principale (S2L, « speed-to-lead ») : un agent vocal rappelle en moins d'une minute chaque personne qui laisse ses coordonnées (formulaire du site, formulaire Facebook ou Instagram, chat). Il la qualifie (soin voulu : Botox, fillers, épilation laser, minceur, perte de poids ; première visite ou non ; délai ; disponibilités) et réserve la consultation dans l'agenda du med spa. En plus : refaire le site s'il est faible.
- Cible : med spas INDÉPENDANTS en Floride et au Texas qui paient déjà des pubs, donc qui reçoivent des demandes et les rappellent souvent trop tard.
- Objectif : 1 000 leads. Si les crédits ne suffisent pas, donne le chiffre exact et le coût pour arriver à 1 000. Ne baisse jamais les critères sans l'accord de Junior.

## 2. Pourquoi on ne passe pas par l'API Meta
L'API de la bibliothèque pub Meta ne donne PAS les pubs commerciales diffusées aux États-Unis (seulement les pubs politiques). On repère donc les pubs sur le site du med spa, et chaque fiche donne les liens pour vérifier à la main. N'utilise aucun robot qui aspire Facebook, Instagram ou la bibliothèque pub Facebook.

## 3. Collecte Google Maps avec Apify (clé n° 2, propre à cette mission)
- Au tout début, demande à Junior une NOUVELLE clé Apify pour cette mission, différente de celle de la mission « sans pubs », dans un message séparé. Enregistre-la dans un fichier lisible par toi seul (chmod 600), hors du dossier du projet. Ne l'affiche jamais, ne l'écris dans aucun fichier livré, supprime-la à la fin et rappelle-lui de la régénérer si elle est passée dans le chat.
- Vérifie le crédit (GET https://api.apify.com/v2/users/me/limits) et annonce le coût avant de lancer. Si le crédit restant est sous 0,50 $ (par exemple une clé d'un compte déjà dépensé), dis-le à Junior et attends une clé avec du crédit.
- Outil : `compass~crawler-google-places`. Paramètres : language "en", countryCode "us", searchStringsArray ["med spa","medical spa","aesthetic clinic"], maxCrawledPlacesPerSearch environ 35, locationQuery "<ville>, <État>, USA". Une ville par lancement, maxTotalChargeUsd de 0,50 $ minimum, toutes les options payantes désactivées (scrapeContacts, scrapeSocialMediaProfiles, maximumLeadsEnrichmentRecords, reviews, images, scrapePlaceDetailPage). Coût : environ 0,004 $ par fiche.
- Villes, à faire dans cet ordre jusqu'au budget :
  - Floride : Miami, Fort Lauderdale, Boca Raton, West Palm Beach, Naples, Fort Myers, Sarasota, Tampa, St. Petersburg, Orlando, Jacksonville ;
  - Texas : Houston, The Woodlands, Katy, Sugar Land, Dallas, Plano, Frisco, Fort Worth, Austin, Round Rock, San Antonio.
- Enregistre le brut dans `medspa_avec_pubs/maps_raw/<ville>.json`. Avant de lancer une ville, regarde si elle est déjà collectée, pour ne jamais payer deux fois la même. Session HTTP persistante, nouvelles tentatives, pauses.

## 4. Tri
- Retire :
  - les établissements fermés et ceux sans téléphone ;
  - les doublons (même place_id ou même numéro) ;
  - les catégories principales Plastic surgeon, Dermatologist, Doctor, Hospital, Hair salon, Nail salon, Massage only ;
  - les chaînes et franchises : Ideal Image, LaserAway, Milan Laser, SkinSpirit, Sono Bello, Ever/Body, European Wax Center, Hand & Stone, Massage Envy, Woodhouse, The Lash Lounge, Restore Hyper Wellness, Skin Laundry, Heyday, AesthetiCare, Alchemy 43, Evolve Med Spa, Vio Med Spa, Ageless Men's Health…, plus toute enseigne présente dans au moins 3 villes ou partageant le même site dans plusieurs villes. Attention aux mots courants (« Glow », « Skin », « Aesthetics ») : ce ne sont pas des marques.
- Garde les catégories : Medical spa, Skin care clinic, Laser hair removal service, Facial spa, Weight loss service et Day spa (ces deux dernières seulement si le nom contient med spa, aesthetic, medical, laser ou wellness).

## 5. Lecture de chaque site (le cœur du travail)
Page d'accueil + jusqu'à 5 pages internes (about, team, meet, founder, providers, specials, offers, contact). Si le site bloque, note « site à vérifier » sans conclure.
- Signaux de pub. CETTE MISSION NE GARDE QUE LES MED SPAS AVEC AU MOINS UN SIGNAL :
  - pixel Meta (connect.facebook.net, fbevents.js, fbq('init') ;
  - balise Google Ads (AW-, googleadservices, gtag avec AW-) ;
  - pages d'offres type pub (/specials, /offer, « limited time », « new client special ») ;
  - tunnel d'agence (leadconnectorhq, msgsndr, GoHighLevel, ClickFunnels).
  - Les med spas sans aucun signal sont écartés ; compte-les dans le résumé.
- Note séparément « Meta pixel: yes/no », « Google Ads tag: yes/no », « Agency funnel (GoHighLevel): yes/no ». GoHighLevel veut souvent dire qu'une agence les suit déjà : priorité un peu plus basse, on le leur dit autrement.
- Comment les demandes arrivent : formulaire sur le site (oui/non), chat (Podium, Birdeye, Tidio, Intercom, HubSpot, LeadConnector), réservation en ligne (Vagaro, Boulevard, Mindbody, GlossGenius, Zenoti, Mangomint, Aesthetic Record, Square, Acuity), numéro « text us ».
- État du site (pour vendre le site en plus) : « No website » / « to rebuild » / « to improve » / « OK », avec les raisons (pas de https, pas adapté au mobile, ancien, pas de formulaire, pas de bouton d'appel…).
- Liens Facebook et Instagram trouvés SUR LEUR SITE (sans ouvrir ces réseaux avec un robot).
- Prénom du gérant : « Meet <Prénom> », « <Prénom Nom>, Owner/Founder/CEO », sinon Medical Director ou Nurse Injector. Garde le prénom, le rôle et la source. Ne devine jamais : en cas de doute, « Owner unknown ».

## 6. Plus de prénoms
- Floride : Sunbiz (search.sunbiz.org, « Authorized Person(s) »), à petit rythme.
- Texas : Comptroller, « Taxable Entity Search », à petit rythme.
- Seulement si la société correspond clairement (même nom commercial, même ville). Sinon, laisse vide.
- Option payante avec l'accord de Junior uniquement : les réponses signées aux avis Google, via Apify.

## 7. Score et classement
- Pixel Meta : +2. Balise Google Ads : +1.
- Formulaire ou chat sur le site (des demandes arrivent) : +2.
- Pas de tunnel GoHighLevel (personne ne les rappelle automatiquement) : +1.
- Site faible ou absent (on vend aussi le site) : +1.
- Note de 4,5 ou plus avec 50 avis ou plus (beaucoup de clients) : +1.
- Gérant identifié : +1.
- Tri : score décroissant. À l'intérieur d'un même score, les leads AVEC prénom d'abord, celles sans prénom à la fin.

## 8. Écran d'appel + CRM (tout en anglais)
Artifact avec base de données partagée (capacité db). Charge d'abord « artifact-capabilities » et « artifact-design ». Leads par paquets de 50 dans « lots », résultats dans « resultats/<id> », un document par lead. Couleurs : bleu nuit et corail (change si Junior préfère).
- Onglet « Call screen » :
  - à gauche, la liste avec les filtres To call / Call back / No answer / Interested / Not interested / All (« Call back » ne montre QUE les rappels prévus, triés par date et heure ; « No answer » ne montre que les « pas de réponse », séparément), le filtre Florida/Texas et une recherche ;
  - à droite, la fiche.
- En haut de la fiche :
  - N°, score, ville et État, et L'HEURE LOCALE DU LEAD EN DIRECT avec une pastille « good time to call » de 9 h à 18 h chez lui. Floride = heure de New York, sauf l'ouest de la Floride (Pensacola) ; Texas = heure de Chicago, sauf El Paso.
  - Le prénom du gérant en gros, et son rôle. Sinon, le nom du med spa et « Owner unknown – ask for the owner ».
  - Le téléphone au format (305) 555-0123, avec les boutons Call et Copy.
- « Their ads » :
  - Meta pixel yes/no, Google Ads yes/no, Agency funnel yes/no ;
  - LIEN vers la bibliothèque pub Meta : https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=<nom>&search_type=keyword_unordered ;
  - LIEN vers le centre de transparence Google Ads, recherche par domaine. Teste le format https://adstransparency.google.com/?region=US&domain=<domaine> ; s'il ne marche pas, mets le lien de la page de recherche ;
  - LIENS vers leur page Facebook et leur Instagram s'ils sont trouvés sur le site.
- « How leads come in » : formulaire, chat, réservation en ligne, « text us ».
- « Website » : LIEN cliquable ou gros « NO WEBSITE », état et raisons.
- Lien Google Maps, avec les étoiles et le nombre d'avis.
- Ouverture : « Hi, is <Prénom> in? This is <Junior> from J-Square. »
- Accroche avec SES infos. Exemple : « I saw you're running ads – when someone fills out your form at 9pm, how fast do they get a call back? Our voice assistant calls every lead within 60 seconds, qualifies them and books the consult on your calendar. » Ajoute la phrase sur le site s'il est faible.
- 4 questions : How many leads do you get a month from ads? Who calls them back, and how fast? What happens to leads that come in after hours or on weekends? How many of those leads book a consult?
- Rappel : appels manuels uniquement ; s'il demande à ne plus être appelé, cliquer « Do not call ».
- Boutons de résultat :
  - Interested ;
  - Demo booked ;
  - Not interested ;
  - No answer ;
  - Call back (avec date et heure) ;
  - Do not call.
- Cases « What interests them » : Voice agent (S2L), Website, Ads management.
- Champs : prénom du gérant (s'il est inconnu), notes enregistrées automatiquement, historique des appels. Raccourcis clavier 1 à 6 et ← →.
- Onglet « CRM » :
  - Demos booked (grand chiffre), Called, Reached, Interested, Not interested, Left to call ;
  - un graphique des appels par jour (objectif 100) ;
  - les derniers résultats ;
  - « What interests them » ;
  - les résultats par État et par type de pub (Meta / Google / les deux) ;
  - le tableau des leads à relancer ;
  - un bouton « Copy all for Google Sheets ».
- Teste la page avec de fausses données avant de publier. Après la publication, vérifie que les leads sont bien dans la base.

## 9. Règles
- Prospection entre professionnels, appels manuels uniquement : pas de numéroteur automatique, pas de message préenregistré, pas de SMS sans accord (TCPA, Florida FTSA).
- Respecte immédiatement les « do not call ». Appels entre 9 h et 18 h, heure locale.
- Pas de robot sur Facebook, Instagram, LinkedIn ou la bibliothèque pub Facebook. Pas d'achat de fichiers. Pas d'outil payant sans l'accord de Junior.
- Données professionnelles uniquement. Un rapprochement douteux est signalé, jamais deviné.
- Tiens un fichier `medspa_avec_pubs/deja_livres.json` (place_id) pour ne jamais relivrer un lead.

## 10. Ce que tu livres
1. Le lien de l'écran d'appel.
2. Un court résumé :
   - le nombre de leads par État et par ville ;
   - le pourcentage avec prénom ;
   - la répartition pixel Meta / Google Ads / GoHighLevel ;
   - la répartition par état du site ;
   - le nombre de med spas écartés parce qu'ils ne font pas de pubs ;
   - le coût Apify et le crédit restant sur cette clé ;
   - les limites rencontrées.
3. Si moins de 1 000 leads : le chiffre exact et ce qu'il faut pour y arriver.
4. Supprime le fichier de la clé.
