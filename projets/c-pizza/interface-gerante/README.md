# Interface de la gérante — C Pizza

Démo cliquable du tableau de bord de la gérante. Tous les chiffres sont fictifs.

## Lancer en local

Il faut Node.js 18 ou plus récent, sans rien installer d'autre.

```
cd projets/c-pizza/interface-gerante
npm start
```

Puis ouvrir http://localhost:5173 dans le navigateur.

- Autre port : `PORT=8080 npm start`.
- Sans Node : `python3 -m http.server 5173` dans ce dossier, puis la même adresse.
- Pour la voir sur un téléphone branché au même wifi : remplacer `localhost` par l'adresse de l'ordinateur sur le réseau (par exemple `http://192.168.1.20:5173`).

## Ce qui est cliquable

- Choisir un point de vente : sur sa tour dans la carte, dans les alertes, dans le portefeuille ou dans le tableau.
- « En direct » / « Quartiers » : la carte montre les livreurs en course, ou colore les quartiers selon le nombre de commandes.
- Actions du point de vente : remettre la Calzone en vente (PV 1), envoyer les nouvelles commandes au PV 1 (PV 2), demander un livreur en renfort (PV 3), mettre en pause et reprendre.
- Le bouton « En direct » en haut arrête ou relance la démo, qui ajoute une commande de temps en temps.

## S'adapte à l'écran

- Téléphone (moins de 700 px) : les alertes et le portefeuille des points de vente passent en premier, puis la carte ; le tableau devient des fiches ; le graphique par heure défile.
- Tablette (700 à 1 099 px) : la carte prend toute la largeur, les alertes et le portefeuille sont côte à côte en dessous.
- Ordinateur (1 100 px et plus) : la carte à gauche, les alertes et le portefeuille à droite.

## Fichiers

- `index.html` : la page.
- `styles.css` : la mise en forme, avec les règles pour chaque taille d'écran.
- `app.js` : la carte en 3D, le graphique, le portefeuille et les actions.
- `data.js` : les données d'exemple, à remplacer par la vraie base de données.
- `server.js` : le petit serveur local.
