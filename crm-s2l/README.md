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
