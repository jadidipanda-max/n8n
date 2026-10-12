# ads-s2l — création publicitaire

Le travail de création de contenu pour les pubs des clients J-Square : analyse de ce qui marche chez eux et chez leurs concurrents, puis production des visuels et des vidéos.

## Ce qu'il y a ici

| Fichier | Contenu |
|---|---|
| `jerome-analyse-pubs.md` | Jérôme Gourod (SAFTI Paris 14ᵉ) : ses pubs passées, son marché, le modèle à copier. **En attente de validation par Jay avant production.** |
| `pubs-relevees.csv` | Les 365 pubs relevées dans la bibliothèque publicitaire Meta le 12/10/2026, triées par durée de diffusion. |
| `outils/` | Les scripts qui ont servi à relever et dépouiller les pubs. |

## Comment on mesure une pub

La **bibliothèque publicitaire Meta** est publique et obligatoire dans l'UE. Elle donne, pour chaque pub : date de début, date de fin, texte, visuel, bouton, destination. Elle ne donne **pas** le coût par lead.

L'indicateur retenu est donc la **durée de diffusion** : une pub laissée en ligne 157 jours est une pub payée 157 jours. C'est un indicateur indirect — une agence négligente peut laisser tourner une pub médiocre, et une bonne pub peut être coupée parce que le budget s'arrête. Dès qu'on obtient un accès Ads Manager, on refait le classement au vrai coût par lead.

## Relancer un relevé

Les scripts ont besoin de Node, de `playwright-core` et d'un Chromium.

```bash
cd ads-s2l/outils
npm install playwright-core@1.49.1
export ADLIB_OUT=./data            # où écrire les relevés
export CHROME_PATH=/chemin/vers/chrome   # sinon le Chromium de l'environnement

# un relevé = un libellé, une URL de bibliothèque, un nombre de pubs visé
node scrape_adlib.js safti "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=FR&media_type=all&q=SAFTI&search_type=keyword_unordered" 80

python3 parse_adlib.py             # dépouille tous les relevés de ./data
```

**À savoir** : la bibliothèque limite les requêtes répétées. Un relevé qui revient à 0 pub n'est pas une absence de résultats, c'est un blocage — il faut attendre une minute et relancer. Ne jamais lancer deux relevés en même temps : les deux échouent. Le défilement plafonne autour de 30 pubs par requête ; comme le tri par défaut est le volume d'impressions, ces 30 sont les plus gros annonceurs, ce qui est généralement ce qu'on cherche.

## Mise à jour du 12/10/2026 au soir

Jay a obtenu les accès Ads Manager de Jérôme. Deux ajouts :

- `jerome-analyse-pubs.md` contient désormais une **section 5** avec les vrais coûts par prospect
  (10 ensembles de publicités, période « Maximum »), et un tableau de **degré de confiance** en fin
  de document : les conclusions ont été soumises à quatre analyses contradictoires, et plusieurs
  ont été abandonnées.
- `benchmarks-leads-immobilier.md` : les références de marché pour situer un coût par prospect en
  immobilier français, avec la liste des chiffres qui circulent et **qu'il ne faut jamais citer**
  (arguments commerciaux de vendeurs de leads, attributions fausses à la FNAIM, etc.).

**Enseignement de méthode** : la durée de diffusion relevée dans la bibliothèque et le coût par
prospect relevé dans Ads Manager **ne désignent pas le même gagnant**. Dès qu'un compte est
accessible, c'est lui qui tranche. La bibliothèque reste irremplaçable pour une seule chose :
observer les concurrents, dont on ne verra jamais les comptes.
