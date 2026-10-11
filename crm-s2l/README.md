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
