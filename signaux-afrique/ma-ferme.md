# Ma ferme : base de connaissances

Ce fichier rassemble ce qu'il faut savoir sur la ferme et les décisions prises. Les radars s'en servent, via leur nœud « Paramètres », pour écrire les briefs.

## La ferme

- **Lieu :** Douala (Littoral). Le climat y est très humide, avec une saison plus sèche de décembre à février et de fortes pluies de juillet à septembre.
- **Surface :** 18 hectares, sur lesquels tous les projets sont possibles.
- **Règle principale : cycles courts uniquement, 4 à 5 mois maximum avant la première vente.** Elle s'applique aux cultures comme aux élevages courts (poulet de chair).
- **Deux axes :**
  1. **Produire** des cultures à cycle court sur la ferme ;
  2. **Courtage** (apporteur d'affaires) : mettre en relation acheteurs et vendeurs contre une commission, sans investir, pour tout ce qui ne se produit pas à la ferme.
- **Démarrage des radars : décembre 2026.**

## Ce qui est compatible avec la ferme (cycle de 5 mois maximum)

| Produit | Premières ventes | Remarque |
|---|---|---|
| Poulet de chair | 45 jours par bande | En bâtiment, sur moins de 0,5 ha. L'aliment est le premier poste de coût. |
| Concombres | 2 à 3 mois | |
| Légumes (piment, gombo, aubergine, poivron) | 2 à 3 mois | Vente aux marchés de Douala. |
| Tomates | 3 mois | Mieux en saison sèche, avec irrigation : les grosses pluies favorisent les maladies. |
| Pastèques | 3 mois | En saison sèche, avec irrigation. |
| Niébé, haricot | 2 à 3 mois | Possible, mais l'humidité favorise les maladies. |
| Maïs | 3 à 4 mois | Le maïs frais en épis se vend sans séchage. Le grain est difficile à sécher et à stocker à Douala. |
| Arachide | 3 à 4 mois | Pousse mieux en savane ; possible sur sol sableux. |
| Piment séché | 3 à 4 mois | Se garde et se vend loin (Gabon, Nigeria). |
| Patate douce | 3 à 5 mois | Le manioc, lui, est trop long. |
| Soja | 4 mois | Pour la provende ; mieux adapté aux savanes. |
| Riz de bas-fonds | 4 à 5 mois | Le riz importé arrive très bon marché ; il faut de la mécanisation. |
| Poules pondeuses | 5 mois avant la ponte | Puis des œufs chaque jour pendant environ un an. |

On peut aussi ajouter, plus tard, de la transformation (provende, gari) : elle ne demande pas de cycle de culture.

## Ce qui est exclu pour la ferme (trop long), en courtage seulement

| Produit | Délai | Remarque |
|---|---|---|
| Pisciculture | 6 à 8 mois | |
| Manioc | 9 à 12 mois | |
| Gingembre | 8 à 10 mois | |
| Plantain | 10 à 14 mois | |
| Ananas | 14 à 18 mois | |
| Palmier à huile | environ 3 ans | |
| Cacao, café, cocotier | plusieurs années | |
| Oignons, pommes de terre, sésame | — | Pas adaptés au climat de Douala (Nord ou altitude). |

Ces produits restent intéressants **en courtage**. Le Cameroun importe par exemple beaucoup d'huile de palme (167 M$ en 2023) et de poisson congelé (303 M$ en 2023).

## Ce que les données disent pour des cycles courts

- Les **statistiques officielles d'importation voient mal les légumes et le maïs frais**. Ils se vendent surtout sur place ou passent les frontières vers le Gabon, la Guinée équatoriale ou le Congo de façon informelle. Pour ces produits, les meilleurs signaux sont **les prix sur les marchés de Douala et de Yaoundé** (veille quotidienne) et les contacts terrain.
- **Exemple de signal de prix**, octobre 2026 : « Tomate : l'abondance de l'offre fait chuter les prix à Yaoundé ». Planter des tomates quand tout le monde en a fait chuter les prix. D'où l'intérêt de **viser les périodes où l'offre est faible**, comme la saison sèche avec irrigation.
- Les chiffres officiels le confirment : en 2023, le Cameroun a déclaré presque aucune importation de tomates (0,02 M$), de concombres, de pastèques ou de légumes frais.
- Signal pour la volaille, en octobre 2026 : « Importations de poulet de chair : la facture annuelle du Gabon grimpe à 85 milliards de FCFA ». C'est une piste de courtage, puis un débouché possible.
- Ce que le Cameroun importe et que la ferme pourrait produire en partie, d'après les chiffres de 2023 :
  - riz : 334 M$ ;
  - provende : 27 M$ ;
  - maïs : 13 M$ ;
  - haricots : 9 M$.

## Où ces règles sont appliquées

- **Radar 1, nœud « Paramètres » :**
  - `ferme.cycleMaxMois = 5` ;
  - chaque produit a son `cycleMois`. Au-delà de 5 mois, il n'est jamais proposé comme projet, seulement en courtage ;
  - jusqu'à 5 places du top sont réservées aux produits compatibles avec la ferme, en priorité sur le marché camerounais.
- **Radar 2, nœud « Paramètres » :** `mesProjets` contient « Cultures courtes » et « Volaille ». Les signaux qui en parlent passent en premier.
- **Pour changer une règle**, modifier ce fichier et les nœuds « Paramètres », pour que les deux restent d'accord.
