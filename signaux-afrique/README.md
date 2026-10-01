# Signaux commerce Afrique

Un système n8n qui repère chaque jour et chaque mois **ce que le Cameroun, ses voisins et d'autres marchés achètent**. Il t'aide à décider quoi produire, quoi exporter, et pour quels produits te positionner comme apporteur d'affaires. Il range aussi les **contacts** au même endroit (acheteurs publics, plateformes B2B).

```
 SOURCES                         n8n                         TOI
 ─────────────────────────       ─────────────────────       ──────────────────────────
 ONU Comtrade (douanes)    ──►   Radar 1 (chaque mois)  ─┐
 Banque mondiale (AO)      ──►   Radar 2 (chaque jour)  ─┼─► Google Sheet  ──►  email
 Google Actualités         ──►                          │    (3 onglets)        │
 Emails Go4WorldBusiness,  ──►   Radar 3 (chaque heure) ─┘                       ▼
 Tridge, TradeKey…                                               appels, devis, deals
```

## Les 3 radars

| Fichier | Quand | Ce qu'il fait | Où ça va |
|---|---|---|---|
| `workflows/1-radar-opportunites.json` | le 1er du mois | Importations de 24 produits agricoles dans 25 pays (Cameroun, CEMAC, Nigeria, Afrique de l'Ouest, Europe, Chine, Émirats…). Il calcule un **score de 0 à 100** pour chaque couple pays + produit. Pour les 15 meilleures pistes (2 pays maximum par produit), il donne **qui fournit aujourd'hui** et la part de l'Afrique et du Cameroun. | onglet `Opportunites` + email |
| `workflows/2-veille-quotidienne.json` | chaque jour à 7 h | **Appels d'offres** de la Banque mondiale en Afrique (semences, vivres, intrants…), avec **l'organisme acheteur, son email et son téléphone**. Il ajoute les **actualités** sur les pénuries, les interdictions d'export et les flambées de prix. Il ne garde que ce qui touche tes produits (et, pour les actualités, qui parle aussi de commerce), et seulement ce qu'il n'a jamais vu. | onglet `Signaux` + email s'il y a du nouveau |
| `workflows/3-leads-b2b-email.json` | toutes les heures | Lit les alertes email des plateformes B2B et crée une **fiche contact** : acheteur ou vendeur, produits, pays, quantité, coordonnées, **alerte arnaque**. | onglet `Contacts` |

Les 3 radars ont été testés dans n8n 2.41 avec de vraies données. Voir « Ce qui a été vérifié » plus bas.

## Installation (environ 30 minutes, une seule fois)

1. **La Google Sheet.** Ouvre Google Drive, puis *Nouveau → Importer un fichier* et choisis `modele-google-sheets.xlsx`. Ouvre-le avec Google Sheets puis *Fichier → Enregistrer au format Google Sheets*. Copie l'adresse de la page : elle ressemble à `https://docs.google.com/spreadsheets/d/1AbC…/edit`.
2. **n8n.** Il te faut un n8n : la version cloud (n8n.io) ou une installation sur un serveur. Dans n8n, clique sur *Create workflow*, puis le menu `…` → *Import from file*, et choisis un fichier du dossier `workflows/`. Recommence pour les 3 fichiers.
3. **Le compte Google.** Dans chaque nœud *Google Sheets* et *Gmail*, choisis *Create new credential* et connecte ton compte Google. C'est un seul clic sur n8n cloud. Sur un serveur à toi, il faut créer un accès OAuth dans Google Cloud : suis le guide n8n « Google credentials ».
4. **Le nœud « Paramètres »** (radars 1 et 2). Ouvre-le et remplace :
   - `email` : où recevoir les résumés ;
   - `googleSheetUrl` : l'adresse copiée à l'étape 1 ;
   - dans le radar 1, le `statut` de chaque produit : `'je produis'`, `'je peux produire'`, `'je peux sourcer'` ou `''`. C'est ce qui personnalise le score. Tu peux aussi ajouter des produits (code douanier à 4 ou 6 chiffres) ou des pays (code ONU).

   Pour le radar 3, colle l'adresse de ta feuille directement dans le nœud *Google Sheets : Contacts*.
5. **Tester.** Clique sur *Execute workflow*. Le radar 1 prend 2 à 4 minutes, car il laisse 3 secondes entre deux appels pour respecter les limites de l'API gratuite. Ne le relance pas plusieurs fois de suite : voir « Les limites ».
6. **Activer.** Mets l'interrupteur *Active* en haut à droite. La mémoire « déjà vu » du radar 2 ne marche qu'une fois le workflow activé : pendant les tests, tout apparaît comme nouveau.
7. **Pour le radar 3.** Inscris-toi gratuitement sur 2 ou 3 plateformes B2B, par exemple Go4WorldBusiness, Tridge, TradeKey, ExportHub ou EC21. Active leurs alertes « buying leads » sur tes produits. Dans Gmail, crée un libellé `leads-b2b` et un filtre qui y range ces emails.

## Lire le score du radar 1

| Part | Critère | 0 point | Maximum |
|---|---|---|---|
| 35 % | Taille du marché (importations par an) | 1 million $ | 1 milliard $ |
| 25 % | Croissance sur 3 ans | −10 %/an | +30 %/an |
| 20 % | Proximité (valeur `proximite` du pays) | 0 | 1 (Cameroun) |
| 20 % | Ta position sur le produit | surveillance | « je produis » |

Chaque ligne porte un **type de signal** :

- **Remplacer des importations au Cameroun** : le pays achète à l'étranger quelque chose qu'on pourrait produire sur place (riz, poisson, huile de palme, maïs, oignons…). Ce sont souvent les meilleures pistes pour une ferme. Les acheteurs sont à Douala et Yaoundé, sans frontière ni devise.
- **Exporter ou faire du courtage en Afrique** : un voisin importe beaucoup, et surtout hors d'Afrique. Regarde la colonne `part_afrique_pct` : plus elle est basse, plus il y a de place pour un fournisseur africain.
- **Exporter hors d'Afrique** : de gros marchés, mais des normes exigeantes.

La colonne `prix_usd_kg` donne le **prix moyen payé à l'import**. Compare-le à ton coût de revient rendu chez l'acheteur, transport compris.

## Transformer un signal en contact

Le système trouve les signaux, mais c'est toi qui crées la relation. Une méthode simple :

1. **Chaque lundi**, trie l'onglet `Signaux` sur `priorite = haute` et choisis 3 pistes. Note-les `à creuser`.
2. **Appel d'offres** : l'email et le téléphone de l'acheteur sont dans la colonne `contact`. Lis le dossier (lien), vérifie que tu peux livrer le lot, et associe-toi avec un fournisseur si besoin. C'est le rôle d'apporteur d'affaires.
3. **Marché qui importe** (radar 1) : il te faut des noms d'importateurs. Ces sources sont gratuites ou peu chères :
   - **ITC Trade Map** et **Export Potential Map** (intracen.org), gratuits pour les utilisateurs des pays en développement. On y voit les entreprises importatrices par produit et le potentiel d'export du Cameroun par marché.
   - La **CCIMA** (Chambre de commerce du Cameroun), les **services économiques des ambassades** (au Cameroun et celle du Cameroun dans le pays cible) et les annuaires des chambres de commerce étrangères.
   - Les **salons** : Promote (Yaoundé), SIAL Paris (octobre, années paires), Gulfood (Dubaï, début d'année), Fruit Logistica (Berlin, février), la Foire commerciale intra-africaine d'Afreximbank. Vérifie les dates.
   - Les achats humanitaires : le **PAM (WFP)** achète des vivres en Afrique, y compris au Cameroun. On s'inscrit comme fournisseur sur **UNGM** (ungm.org).
4. **Note tout** dans l'onglet `Contacts` : `statut` (nouveau → contacté → en discussion → deal / sans suite) et `prochaine_action`. Même sans deal, un contact qualifié a de la valeur pour la prochaine piste.
5. **En tant qu'apporteur d'affaires**, fais signer un **contrat d'apporteur d'affaires** qui fixe ta commission, ou au minimum un accord de non-contournement et de confidentialité (souvent appelé NCNDA), *avant* de mettre l'acheteur et le vendeur en relation.

### Prudence

Le commerce agricole en ligne attire beaucoup d'arnaques. Le radar 3 signale les emails qui parlent de frais d'inscription, de frais d'échantillon, de Western Union ou de paiement d'avance. Les règles de base :

- ne jamais payer pour « débloquer » un acheteur ;
- vérifier l'entreprise (registre du commerce, site, appel vidéo) ;
- pour une vente, exiger une lettre de crédit confirmée ou un paiement contre documents.

## Les limites (pour bien lire les chiffres)

- **ONU Comtrade publie avec 1 à 2 ans de retard**, et certains pays ne déclarent pas ou tardent beaucoup. Lors des tests, il n'y avait aucun chiffre pour le Tchad et la Guinée équatoriale, et pas de chiffres après 2023 pour le Cameroun, le Congo et le Gabon. L'email liste les pays sans chiffres. Pour eux, appuie-toi sur la veille quotidienne et le terrain.
- Les chiffres officiels ne voient pas le **commerce informel** aux frontières, très important entre le Cameroun, le Nigeria, le Gabon, la Guinée équatoriale, le Tchad et la RCA. C'est le cas de la noix de cola, des tomates, des oignons ou du bétail : le radar 1 les sous-estime, mais la veille et les contacts terrain compensent.
- La version **gratuite et sans clé** de Comtrade a un **quota d'appels qui se recharge toutes les 10 minutes**. Lors des tests, 40 appels d'affilée sont passés sans refus. Un passage du radar 1 en utilise une vingtaine, donc ça passe. En revanche, si tu le lances 2 ou 3 fois de suite pendant les tests, des requêtes sont refusées. Dans ce cas, l'email l'indique en haut (« requêtes refusées, relance dans 10 minutes ») et certains chiffres manquent ou sont marqués « données anciennes ».
- Pour suivre beaucoup plus de pays ou de produits, crée une clé gratuite sur comtradedeveloper.un.org et colle-la dans `cleComtrade` (nœud Paramètres). Cette option suit la documentation de Comtrade mais n'a pas pu être testée ici, faute de clé.
- Les noms des pays fournisseurs (« Brazil », « India »…) sont en anglais, car c'est ainsi que Comtrade les donne.
- Les flux **Google Actualités** sont prévus pour un usage personnel de veille. Pour une veille plus large, crée des **Google Alertes** avec l'option « Envoyer à : flux RSS » et ajoute leur adresse dans un nœud RSS.
- **Un signal est une piste, pas une commande.** Le score dit où regarder, pas quoi signer.

## Aller plus loin

- Recevoir les alertes sur **WhatsApp ou Telegram** : remplace le nœud Gmail par le nœud Telegram (simple) ou WhatsApp Business Cloud (plus de configuration).
- Ajouter d'autres sources d'appels d'offres : Banque africaine de développement, UNGM, marchés publics camerounais (ARMP).
- Ajouter une étape d'IA qui résume chaque signal et propose un message d'approche.
- Suivre les **prix mondiaux** (cacao, café, maïs, riz, huile de palme) avec les données mensuelles de la Banque mondiale (« Pink Sheet »).

## Ce qui a été vérifié

Les 3 fichiers ont été importés et lancés dans n8n 2.41.4 le 1er octobre 2026, avec les nœuds Google Sheets et Gmail désactivés, faute d'accès à ton compte Google :

- **Radar 1** : avec un quota neuf, les 22 requêtes Comtrade passent en 4 minutes environ. 548 couples pays + produit sont notés, les fournisseurs du top 15 sont trouvés et l'email est généré. Exemples de pistes sorties :
  - Cameroun : 167 M$ d'huile de palme importée en 2023 (+39 %/an) ;
  - Cameroun : 303 M$ de poisson congelé, dont 75 % hors d'Afrique ;
  - Congo : 250 M$ de volaille, presque rien venant d'Afrique ;
  - Gabon : 88 M$ de riz, venu presque entièrement d'Asie.
- **Radar 2** : 29 appels d'offres de la Banque mondiale ouverts en Afrique ont été lus, et 9 recherches d'actualités ont renvoyé 36 articles. Après filtrage, il restait 13 signaux, dont un appel d'offres pour l'achat de denrées alimentaires au Tchad, avec l'email et le téléphone de l'acheteur. La mémoire « déjà vu » marche aussi : au passage suivant, 0 doublon.
- **Radar 3** : sur des emails d'exemple, il reconnaît l'acheteur, le produit, le pays, la quantité, l'email et le téléphone, et lève l'alerte arnaque sur « registration fee » et « Western Union ».

Il te reste à brancher ton compte Google et à vérifier que l'écriture dans ta Google Sheet et l'envoi des emails se passent bien.
