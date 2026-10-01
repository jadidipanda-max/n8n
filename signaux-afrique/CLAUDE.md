# Signaux commerce Afrique

- Lire `ma-ferme.md` avant toute modification : c'est la base de connaissances de la ferme (18 ha à Douala, cycles courts de 5 mois maximum, deux axes production + courtage, démarrage en décembre 2026). Toute nouvelle règle ou décision de l'utilisateur sur la ferme s'y ajoute.
- Les workflows `workflows/*.json` sont générés : modifier `source/js/*.js` (le code des nœuds Code) ou `source/build.py` (les nœuds et les liens), puis lancer `python3 source/build.py workflows`. Ne pas éditer les JSON à la main.
- Pour le modèle de feuille : `python3 source/template.py modele-google-sheets.xlsx` (il faut `openpyxl`). Les colonnes doivent correspondre aux champs produits par les nœuds Code.
- Pour tester : importer avec `n8n import:workflow` et lancer avec `n8n execute --id=…`, en désactivant les nœuds Google Sheets et Gmail. n8n 2.x demande Node 24 ou plus.
- L'API ONU Comtrade gratuite a un quota (recharge par tranches de 10 minutes ou d'une heure) : éviter d'enchaîner les tests du radar 1.
- Écrire pour l'utilisateur en français simple : il est agriculteur et apporteur d'affaires, pas développeur.
