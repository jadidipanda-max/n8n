# Standard S2L (écran d'appel + CRM)

Page publiée sur claude.ai (artifact privé). Ce fichier est une copie du code de la page.

- Les leads et les résultats d'appel ne sont pas dans ce fichier : ils sont stockés dans la base de données de l'artifact (collections `leads` et `resultats`).
- Onglet « Écran d'appel » : une fiche par gérant, classées par score, avec 5 résultats (Intéressé, RDV démo, Pas intéressé, Pas de réponse, À rappeler) et une note enregistrée automatiquement.
- Onglet « CRM » : indicateurs calculés en direct à partir des résultats.

## Priorités, pixel Meta et étude de marché (1er octobre)

- **Écran 1** : les leads sont reclassées par priorité (P1 esthétique avec 1 à 5 pubs, P2 esthétique avec plus de pubs, P3 immobilier, P4 cuisinistes et traiteurs). À l'intérieur, les leads avec un nom de gérant et un pixel absent passent en premier. Le classement et les infos de site sont dans la collection `enrich` (2 documents) que la page fusionne au chargement ; les fiches `leads` ne sont pas modifiées.
- Chaque fiche montre « Son site et ses pubs » : site trouvé, pixel Meta (trouvé / pas trouvé / à vérifier), balise Google Ads, où envoient ses pubs, agence ou outil détecté, outil de réservation, et la phrase à dire au téléphone.
- **Les deux écrans** ont un bloc « Étude de marché » sur chaque fiche (qui gère ses pubs, prestataire, frais de gestion, budget pub, demandes par mois, fin d'engagement, satisfaction) et un panneau « Étude de marché » dans le CRM. Ces champs partent aussi dans l'export Excel.
- Les scripts sont dans `outils/` : `find_sites.py` (retrouve les sites, vérifiés par le téléphone ou le nom et la ville), `pixel.py` (navigateur), `static.py` (lecture du code), `build_enrich.py` (priorités et phrases).

## Écran Pest Control « Zéro appel perdu » (11 octobre)

- `pest.html` : même écran que « Acquisition », adapté au pest control. Les leads sont dans la collection `lots` (9 documents de 50 leads), les résultats d'appel dans `resultats`.
- **Source des leads** : fiches Google Maps (Apify, 30 villes × « dératisation » et « punaises de lit », 640 fiches, 3,20 $), puis le registre des entreprises pour le gérant, la date de création et l'effectif.
- **D'où vient chaque numéro** : celui que l'entreprise publie elle-même, sur sa fiche Google ou sur son site. Aucun annuaire de particuliers, aucun fichier acheté. Quand la fiche Google donne un fixe et que le site affiche un portable de l'entreprise, la fiche montre le portable et garde le fixe en dessous (le portable d'une agence web dans les mentions légales est écarté).
- **Fiabilité du nom du gérant** affichée sur chaque fiche :
  - **sûr** : SIREN ou nom du gérant trouvé sur son propre site ;
  - **probable** : rapprochement nom + département + activité dans le registre ;
  - **à confirmer** : entreprise créée en 2025-2026 mais déjà 30 avis ou plus (changement de statut ou homonyme) ;
  - **affiché sur son site** : nom donné par le responsable du site quand le registre n'en donne pas.
- Les entrepreneurs qui ont demandé la non-diffusion au registre n'ont pas de nom tiré du registre : la fiche dit de demander le gérant sans citer de nom.
- **Exclus avant l'appel** : franchises et réseaux (Eden Vert 3D, Sanipure, Avipur, Pestaly, Farago, NGAN, Tous les Nuisibles, Guêpe Éclair, Stop Guêpes et Frelons, SADED, Doc Pest), grands groupes et leurs filiales (Elis, Rentokil, Techmo, Strehl), entreprises à 3 agences ou établissements ou plus, standards ou centres d'appel, services publics, doublons, entreprises de plus de 10 salariés. La liste et la raison de chaque exclusion sont produites par `apply_verify.py`.
- Scripts dans `outils/pest/`, à lancer dans un dossier de travail hors du dépôt (ils lisent et écrivent `raw/`, `sites/`, `leads_pest.json`) :
  `run_pest.py` (collecte Apify) → `process_pest.py` (tri, registre, note ICP) → `crawl_sites.py` (lecture des sites) → `reg_check.py` (établissements, siège, CA) → `verify_pest.py` (signaux : franchise, agences, capital, numéros partagés, portable du site, nom) → relecture à la main → `apply_verify.py` (exclusions et corrections) → `mk_lots.py` (lots de 50).
- `mk_pest.py` reconstruit `pest.html` à partir de `acquisition.html` (à lancer depuis `crm-s2l/`).

## Écran Chauffage-Clim (11 octobre)

- `cvc.html` : même écran que Pest Control, adapté au chauffage, à la climatisation et à la plomberie-chauffage. Leads dans la collection `lots` (6 documents), résultats dans `resultats`.
- **ICP** : entreprise indépendante de 3 à 15 personnes (au moins 2 techniciens), qui fait du dépannage et de l'entretien en plus de l'installation, avec au moins 30 avis Google, plusieurs communes desservies, une urgence ou une intervention rapide affichée, pas de standard permanent, et un gérant joignable sur son portable.
- **Collecte** : Google Maps via Apify, 30 villes × « chauffagiste » et « climatisation », 600 fiches, 3 $.
- **Contrôles automatiques** (`process_cvc.py`) :
  - au moins 30 avis Google ;
  - retrait des grands groupes, enseignes et distributeurs (Savelys, IZI by EDF, Proxiserve, Sonepar…) ;
  - retrait des réseaux repérés parce qu'ils ont le même site ou le même numéro dans plusieurs villes (Clim+, Garanka, Solaire Clim Chauffage, SL2A, Axenergie…) ;
  - au registre : retrait des entreprises de 20 salariés ou plus et des codes d'activité de commerce ;
  - lecture du site : dépannage, entretien, installation, urgence, communes desservies, secrétariat ou service client, portable de l'entreprise, nom du responsable.
- **Relecture à la main** (`exclusions.json`, appliquée par `apply_cvc.py`) :
  - retrait des franchises et réseaux d'agences (Kaltea, Intergaz, Selfcity, MonChauffagiste, Hello Depann'…), des entreprises à 3 agences ou établissements ou plus, des filiales de groupe, des dépanneurs qui font aussi de la serrurerie et des centres d'appel ;
  - retrait des entrepreneurs individuels sans salarié déclaré, probablement seuls alors que l'ICP demande au moins 2 techniciens.
- **Priorités** :
  - P1 : taille confirmée au registre (3 à 19 salariés) et portable ;
  - P2 : portable, taille à confirmer pendant l'appel ;
  - P3 : ligne fixe.
- `mk_cvc.py` reconstruit `cvc.html` à partir de `pest.html` (à lancer depuis `crm-s2l/`).

## Pitch dans les écrans (12 octobre)

- Les écrans Pest Control et Chauffage-Clim affichent le pitch complet issu de `offre-s2l/pain-points-pitchs.md` : ouverture (avec le nombre d'avis et l'origine des coordonnées), accroche, 3 questions, proposition, calcul à faire faire au prospect, fermeture sur un rendez-vous de démo, puis un volet repliable « Objections et message de répondeur ».
- Les textes sont dans `outils/pitch.py` (un bloc par niche). `mk_pest.py` les injecte dans `pest.html`, puis `mk_cvc.py` remplace le bloc par celui du chauffage-clim. Pour changer un texte, modifier `pitch.py`, relancer les deux scripts depuis `crm-s2l/`, puis republier.
