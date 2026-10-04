# Mettre en ligne le cockpit J-Square

Ce guide t'accompagne, Jay, de la commande du serveur jusqu'au premier rapport du soir. Pas besoin d'être développeur : tu copies des commandes, tu cliques dans des écrans, et après chaque étape tu vérifies que ça marche avant de passer à la suivante.

**Compte 2 à 3 heures**, en une ou deux fois. Tu peux t'arrêter entre deux étapes : rien ne se perd.

## Ce que tu auras à la fin

- `https://cockpit.<ton-domaine>` : la tour de contrôle, avec un compte et un mot de passe pour toi et pour Junior ;
- `https://n8n.<ton-domaine>` : n8n, protégé par ton mot de passe, qui range les paiements Stripe dans Supabase et lance le rapport de 23 h ;
- Hermès sur le serveur, qui lit Supabase **en lecture seule** et répond dans la messagerie du cockpit ;
- une sauvegarde automatique chaque nuit.

```
Navigateur ──HTTPS──> Caddy ──> cockpit (tour de contrôle) ──> Supabase (les données)
                         └────> n8n <── Stripe (paiements)        ^
                                 │                                │ lecture seule
                                 └──> relais ──> Hermès ──────────┘
                    (le relais et Hermès restent dans le serveur, jamais sur Internet)
```

## Avant de commencer

Il te faut :

- un **gestionnaire de mots de passe** (Bitwarden, 1Password…) : tu vas y ranger une dizaine de clés ;
- un compte **OVHcloud**, un compte **Supabase**, ton compte **Stripe**, un compte **Anthropic** (console.anthropic.com) et ton compte **GitHub** ;
- ton nom de domaine (par exemple `jsquare.fr`). Dans ce guide, remplace toujours `<ton-domaine>` par le tien.

Comment lire ce guide :

- un bloc gris est une commande à **copier-coller** telle quelle, puis Entrée ;
- un texte entre `< >` est à remplacer par ta valeur (sans les `< >`) ;
- **Tu vois** : ce qui doit apparaître à l'écran ; **Vérifie** : le test qui prouve que l'étape a marché.

Si quelque chose ne ressemble pas à ce qui est écrit, va voir [Si ça ne marche pas](#si-ça-ne-marche-pas) en bas de page.

---

## Étape 1. Commander le VPS

1. Sur **ovhcloud.com**, commande un **VPS** avec au moins **8 Go de mémoire** (environ 9 € par mois), dans un centre de données **en France**.
2. Système d'exploitation : **Ubuntu 24.04**. Pas d'application préinstallée.
3. Si on te propose d'ajouter une **clé SSH**, ajoute-la (c'est plus sûr) ; sinon, OVH t'enverra un mot de passe.
4. Valide et paie.

**Tu vois** : quelques minutes plus tard, un e-mail d'OVH avec l'**adresse IP** du serveur (4 nombres séparés par des points, par exemple `51.83.12.34`), le nom d'utilisateur **`ubuntu`** et, sans clé SSH, un mot de passe. Range-les dans ton gestionnaire de mots de passe.

**Vérifie** : ouvre un terminal sur ton ordinateur (Mac : application **Terminal** ; Windows : **PowerShell**) et tape :

```bash
ssh ubuntu@<adresse-IP>
```

La première fois, il demande `Are you sure you want to continue connecting?` : tape `yes`. Puis ton mot de passe (rien ne s'affiche quand tu tapes, c'est normal). **Tu vois** une ligne qui finit par `ubuntu@...:~$`. Tu es dans le serveur. Tape `exit` pour en sortir.

## Étape 2. DNS : relier ton domaine au serveur

Il faut deux adresses qui pointent vers l'IP du serveur : `cockpit.<ton-domaine>` et `n8n.<ton-domaine>`.

Chez OVH (si ton domaine y est) : **Web Cloud > Noms de domaine > ton domaine > Zone DNS > Ajouter une entrée**.

1. Type **A**, sous-domaine `cockpit`, cible : l'adresse IP du serveur. Valide.
2. Recommence : type **A**, sous-domaine `n8n`, même adresse IP.
3. S'il existe déjà une entrée **AAAA** pour `cockpit` ou `n8n`, supprime-la (elle enverrait une partie des visiteurs ailleurs, et le certificat HTTPS échouerait).

Ailleurs (Gandi, Ionos, Cloudflare…) : c'est la même chose dans la page « DNS » de ton domaine. Sur Cloudflare, laisse le nuage **gris** (« DNS only »).

**Vérifie** (après 5 minutes à 1 heure) : sur ton ordinateur,

```bash
nslookup cockpit.<ton-domaine>
nslookup n8n.<ton-domaine>
```

**Tu vois** l'adresse IP du serveur dans la réponse (ligne `Address:`). Tant que ce n'est pas le cas, attends : le HTTPS de l'étape 5 a besoin que ce soit bon.

## Étape 3. Supabase : la base de données

### 3.1 Créer le projet

1. Sur **supabase.com**, **New project**. Nom : `jsquare`. Mot de passe de la base : clique sur **Generate a password** et range-le.
2. **Region** : **West EU (Paris)**.
3. Plan : **Pro** (sauvegardes quotidiennes de la base). Clique **Create new project**.

**Tu vois** le tableau de bord du projet après 1 à 2 minutes.

### 3.2 Coller la migration (le schéma de la base)

1. Sur GitHub, ouvre le fichier `supabase/migrations/20261003000000_cockpit.sql` de ton dépôt, clique sur **Raw**, puis sélectionne tout (Ctrl+A ou Cmd+A) et copie.
2. Dans Supabase : **SQL Editor > New query**. Colle, puis clique **Run**.

**Tu vois** : `Success. No rows returned`.

**Vérifie** : dans une nouvelle requête, colle et lance :

```sql
select cle from public.reglages order by cle;
```

**Tu vois** 5 lignes : `change`, `cotisations`, `objectif_mensuel`, `partage`, `seuils`. Dans **Table Editor**, tu vois aussi les tables `profils`, `clients`, `paiements`, `actions`…

La migration se recolle sans risque : si tu as un doute, relance-la.

### 3.3 Fermer les inscriptions publiques

Personne ne doit pouvoir se créer un compte tout seul.

1. **Authentication > Sign In / Providers** : désactive **Allow new users to sign up**, puis **Save**.
2. **Authentication > URL Configuration** :
   - **Site URL** : `https://cockpit.<ton-domaine>` ;
   - **Redirect URLs** : **Add URL**, `https://cockpit.<ton-domaine>/**`. Enregistre.

Le second réglage sert au bouton « Mot de passe oublié ? » : le lien reçu par e-mail ramène sur le cockpit.

**Vérifie** : l'interrupteur **Allow new users to sign up** est bien éteint (gris).

### 3.4 Créer les comptes de Jay et de Junior

1. **Authentication > Users > Add user > Create new user**.
2. E-mail de Jay, un mot de passe solide (12 caractères ou plus), coche **Auto Confirm User**. Clique **Create user**.
3. Recommence pour Junior avec son e-mail. Donne-lui son mot de passe de vive voix ou par un canal sûr ; il pourra le changer avec « Mot de passe oublié ? ».

**Tu vois** les deux adresses dans la liste **Users**.

### 3.5 Donner leur rôle à Jay et à Junior (table `profils`)

Un compte sans ligne dans `profils` ne voit rien. Dans **SQL Editor > New query**, colle ceci en remplaçant les deux adresses e-mail par les vraies, puis **Run** :

```sql
-- Jay : admin, marché France
insert into public.profils (id, nom, role, marche)
select id, 'Jay', 'admin', 'fr' from auth.users where email = 'jay@exemple.fr'
on conflict (id) do update set nom = excluded.nom, role = excluded.role, marche = excluded.marche;

-- Junior : associé, marché USA
insert into public.profils (id, nom, role, marche)
select id, 'Junior', 'associe', 'us' from auth.users where email = 'junior@exemple.com'
on conflict (id) do update set nom = excluded.nom, role = excluded.role, marche = excluded.marche;
```

**Vérifie** : lance cette requête.

```sql
select u.email, p.nom, p.role, p.marche
from public.profils p join auth.users u on u.id = p.id
order by p.role;
```

**Tu vois** 2 lignes : ton e-mail avec `admin` et `fr`, celui de Junior avec `associe` et `us`. Si une ligne manque, l'adresse e-mail ne correspond pas exactement à celle de **Users** : corrige-la et relance le premier bloc.

### 3.6 Récupérer les clés

Dans **Project Settings > API Keys** :

1. Copie la clé **publishable** (`sb_publishable_…`) : elle ira dans le cockpit. Ce n'est pas un secret.
2. Dans **Secret keys**, crée deux clés séparées (si l'une fuit, tu la supprimes sans toucher à l'autre) :
   - **New secret key**, nom `cockpit` : copie la valeur `sb_secret_…` ;
   - **New secret key**, nom `n8n` : copie la valeur `sb_secret_…`.
3. Dans **Project Settings > Data API**, copie la **Project URL** (`https://<référence>.supabase.co`). La `<référence>` (les lettres avant `.supabase.co`) resservira à l'étape 6.

Range les 4 valeurs dans ton gestionnaire de mots de passe.

## Étape 4. Stripe : préparer l'encaissement

Le flux de paiement sera branché à l'étape 7 : ici, on prépare Stripe.

### 4.1 La clé secrète

**Développeurs > Clés API** : copie la **clé secrète** (`sk_live_…`). Pour tes essais, garde aussi la clé de test (`sk_test_…`, avec l'interrupteur **Mode test**). Elles iront dans n8n.

### 4.2 Le marché de chaque client

Pour chaque client : **Clients >** le client **> Métadonnées > Modifier**, clé `marche`, valeur `fr` ou `us`. Sans cette métadonnée, c'est la devise qui décide (USD = US, le reste = France). Les autres métadonnées possibles sont décrites dans `n8n/README.md`.

### 4.3 La fiche de chaque client dans le cockpit (table `clients`)

La salle **Clients** et le compteur « signés ce mois » lisent la table `clients` de Supabase.

- **Nouveau client** : rien à faire. Dès son premier paiement d'abonnement (ou dès que son abonnement est actif), n8n crée sa fiche : nom, marché, devise, prix mensuel, date de début, et son identifiant Stripe. La fiche appartient à l'associé du marché (toi pour la France, Junior pour les USA).
- **Client qui payait déjà avant la mise en ligne** (ou fiche que tu préfères créer toi-même) : dans Supabase, **Table Editor > clients > Insert > Insert row**. Remplis `marche` (`fr` ou `us`), `nom`, `devise` (`EUR` ou `USD`), `prix_mensuel`, `debut` (date de signature), et surtout **`stripe_customer_id`** : l'identifiant `cus_…` du client, visible dans Stripe en haut de sa fiche. La base rattache alors à cette fiche tous ses paiements, même ceux arrivés avant. Laisse `owner_id` vide : la base met l'associé du marché.
- Tu peux compléter une fiche à tout moment (niche, palier, objectif garanti, prochain point) : n8n ne l'écrase jamais. Seul toi (admin) peux changer le `stripe_customer_id` d'une fiche.

### 4.4 Les deux modèles de facture (France et US)

**Paramètres > Facturation > Factures > Modèles > + Créer un modèle** (en anglais : *Settings > Billing > Invoices > Templates > + Create template*).

1. Modèle **France** : dans le pied de page, « TVA non applicable, art. 293 B du CGI », les pénalités de retard et l'indemnité forfaitaire de 40 € pour frais de recouvrement. Ajoute le SIREN du client en champ personnalisé quand tu l'as.
2. Modèle **US** : « TVA non applicable – art. 259-1 du CGI » (formule à faire confirmer par le comptable) et l'EIN du client en champ personnalisé.
3. Sur chaque client : **Paramètres de facturation** du client, choisis le modèle France ou US. Toutes ses factures, abonnements compris, l'utiliseront.

Les moyens de paiement (prélèvement SEPA en France, ACH aux US) se règlent dans **Paramètres > Moyens de paiement**.

### 4.5 Le webhook

**Ne crée pas de webhook à la main.** n8n le crée lui-même quand tu actives le workflow à l'étape 7 ; un webhook créé à la main enverrait les paiements en double.

**Vérifie** : au moins un client a la métadonnée `marche`, et tes deux modèles apparaissent dans la liste.

## Étape 5. Installer le serveur et lancer `docker compose up`

### 5.1 Copier le code sur le serveur

Connecte-toi (`ssh ubuntu@<adresse-IP>`), puis :

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/jadidipanda-max/n8n.git /opt/jsquare
```

Si le dépôt est **privé**, GitHub demande un nom d'utilisateur et un mot de passe : le nom, c'est ton identifiant GitHub ; le « mot de passe », c'est un **jeton** à créer sur GitHub (**Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**, accès à ce seul dépôt, droit **Contents : Read-only**).

Si le cockpit n'est pas encore sur la branche principale du dépôt, ajoute `--branch <nom-de-la-branche>` après `clone`.

**Vérifie** : `ls /opt/jsquare/deploy` affiche `Caddyfile`, `docker-compose.yml`, `hermes`, `scripts`…

### 5.2 Préparer le serveur (mises à jour, comptes, pare-feu, Docker, sauvegardes)

```bash
sudo bash /opt/jsquare/deploy/scripts/installer-vps.sh
```

Le script fait tout seul :
- les mises à jour d'Ubuntu (et les mises à jour de sécurité automatiques) ;
- le fuseau horaire **Europe/Paris** ;
- ton compte **`jay`** (il te demande de choisir son mot de passe) et un compte **`hermes`** sans aucun droit d'administration ;
- **Docker** depuis le site officiel de Docker ;
- le **pare-feu** : seuls 22 (connexion SSH), 80 et 443 (sites web) sont ouverts ;
- la **sauvegarde** de chaque nuit à 03:30.

**Tu vois**, après quelques minutes, le cadre « Serveur prêt. » avec les 3 commandes suivantes. Tu peux relancer ce script autant de fois que tu veux : il ne refait que ce qui manque.

### 5.3 Te reconnecter avec ton compte

```bash
exit
```

puis, depuis ton ordinateur :

```bash
ssh jay@<adresse-IP>
```

**Vérifie** : `docker ps` affiche une ligne de titres (`CONTAINER ID   IMAGE …`) sans erreur.

### 5.4 Remplir les réglages

```bash
bash /opt/jsquare/deploy/scripts/configurer.sh
```

Il te demande, dans l'ordre :
1. ton nom de domaine (sans `https://` ni `www`) ;
2. ton e-mail (pour les certificats HTTPS) ;
3. la **Project URL** Supabase, la clé **publishable**, puis la clé secrète **`cockpit`** (étape 3.6). Les clés secrètes ne s'affichent pas quand tu les colles, c'est normal ;
4. l'e-mail et le **mot de passe de n8n** (8 caractères au moins, avec un chiffre et une majuscule).

Il génère seul les deux clés longues (`N8N_ENCRYPTION_KEY` et `HERMES_API_KEY`). Tout est écrit dans `/opt/jsquare/deploy/.env`, lisible par toi seul.

**Tu vois** à la fin : `docker-compose.yml et .env sont cohérents.` puis `C'est prêt.`

Range dans ton gestionnaire de mots de passe la clé de chiffrement de n8n (elle est indispensable pour restaurer n8n un jour) :

```bash
grep N8N_ENCRYPTION_KEY /opt/jsquare/deploy/.env
```

### 5.5 Lancer `docker compose up`

```bash
cd /opt/jsquare/deploy
docker compose up -d
```

**Tu vois** le téléchargement des images (1 à 2 minutes la première fois), puis 4 lignes `Started` : `jsquare-caddy-1`, `jsquare-n8n-1`, `jsquare-cockpit-1`, `jsquare-relais-hermes-1`.

**Vérifie** :

```bash
docker compose ps
```

Les 4 services sont `Up` ; après une minute, `n8n` et `cockpit` affichent `(healthy)`.

Puis, dans ton navigateur :
- `https://cockpit.<ton-domaine>` : le cadenas est là et **Tu vois** la page **Connexion** (« Réservé à Jay et Junior. Les comptes sont créés par Jay dans Supabase. »). Connecte-toi avec ton compte de l'étape 3.4 : tu arrives au **QG**. La messagerie Hermès ne répondra qu'après l'étape 6 ;
- `https://n8n.<ton-domaine>` : l'écran de connexion de n8n. Entre l'e-mail et le mot de passe choisis en 5.4.

**Tout de suite après ta première connexion à n8n, active la double authentification.** n8n est ouvert sur Internet et il gardera tes clés secrètes Stripe et Supabase : un mot de passe seul ne suffit pas. Dans n8n : clique sur tes initiales en bas à gauche **> Settings > Personal > Two-factor authentication > Enable 2FA**, scanne le QR code avec ton application d'authentification (Google Authenticator, 1Password…), puis range les **codes de secours** dans ton gestionnaire de mots de passe.

**Vérifie** : déconnecte-toi de n8n et reconnecte-toi : n8n te demande le code à 6 chiffres.

Le premier affichage peut prendre une minute : Caddy obtient les certificats HTTPS.

## Étape 6. Hermès, le centre

Hermès tourne directement sur le serveur, avec le compte `hermes` qui n'a aucun droit d'administration. Son API écoute **seulement sur `127.0.0.1:8642`** (à l'intérieur du serveur) et demande une clé.

### 6.1 Préparer deux clés

1. **Clé Claude** : sur **console.anthropic.com > API Keys > Create Key**, nom `hermes-jsquare`. Copie la clé `sk-ant-…`. Dans les réglages de facturation de la console, pose une **limite de dépense mensuelle** (par exemple 50 €). L'abonnement Claude ne couvre pas cette clé : elle est payée à l'usage.
2. **Jeton Supabase pour la lecture** : sur **supabase.com > Account > Access Tokens > Generate new token**, nom `hermes-lecture`. Si l'écran le propose, limite-le au projet `jsquare` et à la lecture de la base. Copie le jeton `sbp_…`.

   Attention : ce jeton ouvre ton **compte** Supabase, pas seulement la lecture. La lecture seule vient du branchement MCP (`read_only=true`), et c'est pour ça qu'Hermès n'a **ni terminal, ni accès aux fichiers, ni exécution de code, ni web** : il ne peut pas lire le fichier où ce jeton est rangé, même si un message piégé le lui demande. Ne lui rends jamais ces outils (voir « Si ça ne marche pas »).

Range les deux dans ton gestionnaire de mots de passe.

### 6.2 Installer Hermès

Toujours connecté en `jay` :

```bash
sudo bash /opt/jsquare/deploy/scripts/installer-hermes.sh
```

Le script :
- installe Hermès avec le **script officiel** de Nous Research, pour le compte `hermes` ;
- règle l'API sur `127.0.0.1:8642` avec la clé `HERMES_API_KEY` générée à l'étape 5 ;
- te demande la clé Claude, puis le jeton Supabase (la référence du projet est lue toute seule dans `.env`) ;
- branche Supabase **en lecture seule** : `https://mcp.supabase.com/mcp?project_ref=<référence>&read_only=true` ;
- installe ses consignes de rôle (le « centre » de J-Square : `deploy/hermes/SOUL.md`), le fuseau Europe/Paris et des garde-fous (pas de `sudo`, pas de `docker`, pas de pare-feu) ;
- lui retire le terminal, les fichiers, l'exécution de code, le web et le navigateur : il garde seulement la base en lecture seule et sa mémoire. Le script le vérifie auprès d'Hermès lui-même et **arrête le service** si un de ces outils est encore actif ;
- le lance comme un service qui redémarre tout seul au démarrage du serveur.

Si une question s'affiche (« démarrer maintenant ? »), réponds oui.

**Tu vois** à la fin :
- `L'API répond et accepte la clé.`
- `L'API n'a que la base en lecture seule (MCP Supabase) et sa mémoire.`
- une ligne `Écoute :` avec `127.0.0.1:8642` (Hermès) et `172.17.0.1:8642` (le relais), et rien d'autre ;
- `OK : le cockpit joint Hermès.` ;
- le cadre « Hermès est prêt. ».

### 6.3 Pourquoi un « relais » ?

Le cockpit et n8n tournent dans des conteneurs Docker. Pour eux, `127.0.0.1` désigne le conteneur lui-même, pas le serveur : ils ne peuvent donc pas joindre Hermès directement. Le petit service **`relais-hermes`** (lancé par `docker compose`) écoute sur l'adresse interne du pont Docker (`172.17.0.1`, que les conteneurs appellent `host.docker.internal`) et recopie chaque connexion vers `127.0.0.1:8642`.

- Hermès, lui, reste sur `127.0.0.1` : rien ne change pour lui.
- Le pare-feu n'ouvre le port 8642 qu'au réseau interne des conteneurs (`172.30.10.0/24`). Depuis Internet, ce port reste **fermé** : l'API d'Hermès n'est jamais exposée.
- C'est pour ça que `HERMES_URL` vaut `http://host.docker.internal:8642` dans `.env` et dans n8n.

**Vérifie** : connecte-toi au cockpit et écris « Bonjour Hermès, où en est le cash ce mois-ci ? ». **Tu vois** sa réponse après quelques secondes (jusqu'à une minute s'il consulte Supabase).

## Étape 7. n8n : importer les workflows

Le détail complet est dans `n8n/README.md`. Voici le parcours.

### 7.1 Les trois identifiants

Dans n8n : **Overview > Credentials > Create credential**. Les noms doivent être **exactement** ceux-ci (n8n relie les workflows aux identifiants par leur nom) :

| Nom exact | Type | À remplir |
|---|---|---|
| `Stripe J-Square` | **Stripe API** | **Secret Key** : `sk_test_…` pour commencer (étape 4.1). **Signature Secret** : vide pour l'instant, mais **obligatoire** avant le premier vrai paiement (voir 7.4). |
| `Supabase n8n (clé secrète)` | **Header Auth** | **Name** : `apikey`. **Value** : la clé secrète **`n8n`** de l'étape 3.6. |
| `Hermès API` | **Bearer Auth** | **Bearer Token** : la valeur de `HERMES_API_KEY`, affichée par la commande ci-dessous. |

```bash
grep HERMES_API_KEY /opt/jsquare/deploy/.env
```

(Copie ce qui suit le `=`.)

### 7.2 Importer les deux workflows

1. Sur ton ordinateur, télécharge depuis GitHub les fichiers `n8n/workflows/stripe-vers-supabase.json` et `n8n/workflows/rapport-du-soir.json` (ouvre le fichier, puis le bouton **Download raw file**).
2. Dans n8n : **Workflows > Create Workflow > menu ⋯ > Import from File…**, choisis `stripe-vers-supabase.json`. Enregistre. Recommence avec `rapport-du-soir.json`.

### 7.3 Les réglages de chaque workflow

Dans chaque workflow, ouvre le nœud **Réglages** :
- `supabaseUrl` : ta **Project URL** Supabase ;
- `hermesUrl` (rapport du soir) : `http://host.docker.internal:8642` ;
- `hermesModel` (rapport du soir) : `hermes-agent`.

**Vérifie** : aucun nœud n'est marqué en rouge. Sinon, ouvre-le et choisis l'identifiant dans la liste.

### 7.4 Brancher Stripe

1. Active le workflow **stripe-vers-supabase** (interrupteur en haut à droite). n8n crée lui-même le webhook dans Stripe.
2. Dans Stripe (en **Mode test**) : **Développeurs > Webhooks**, ouvre le webhook « Created by n8n for workflow ID … », copie son **Signing secret** (`whsec_…`) et colle-le dans l'identifiant `Stripe J-Square`, champ **Signature Secret**.
3. Pour passer en réel plus tard : mets la clé `sk_live_…` dans l'identifiant, désactive puis réactive le workflow, et recopie le nouveau **Signing secret**.

Le **Signature Secret** n'est pas facultatif : sans lui, n8n accepte n'importe quel faux « paiement » envoyé à l'adresse du webhook, et ce faux cash apparaîtrait dans le cockpit.

**Vérifie** qu'un faux événement est refusé. Dans n8n, ouvre le nœud **Stripe** du workflow : copie la **Production URL** (elle finit par `/webhook`). Sur ton ordinateur :

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{"type":"invoice.paid"}' '<Production URL>'
```

**Tu vois** `401`. Si tu vois `200`, le **Signature Secret** est vide ou faux : recopie-le (étape 2 ci-dessus), puis refais le test. Dans **Executions**, aucune exécution ne doit apparaître pour ce faux événement.

Pour tester avec de faux paiements, suis la partie « Tester avec la Stripe CLI » de `n8n/README.md`.

### 7.5 Le rapport du soir

1. Active le workflow **rapport-du-soir**. Il part tous les soirs à 23:00, heure de Paris.
2. Pour l'essayer tout de suite : ouvre-le et clique **Execute workflow**.

**Vérifie** : dans **Executions**, l'exécution est verte, et le rapport apparaît dans la messagerie du cockpit.

## Étape 8. Vérification finale

Coche chaque ligne :

- [ ] `https://cockpit.<ton-domaine>` s'ouvre avec le cadenas ; tu te connectes et tu arrives au **QG**.
- [ ] Junior, connecté chez lui avec son compte, arrive à la **station USA**.
- [ ] Un message à Hermès dans la messagerie reçoit une réponse.
- [ ] Un faux paiement Stripe (mode test) apparaît dans le journal du cockpit, et l'exécution est verte dans n8n.
- [ ] Le rapport du soir (lancé à la main) arrive dans la messagerie.
- [ ] Sur le serveur, `docker compose ps` (dans `/opt/jsquare/deploy`) montre les 4 services `Up`.
- [ ] Le pare-feu : `sudo ufw status` montre `22/tcp`, `80/tcp`, `443` ouverts à tous (`Anywhere`) et `8642/tcp` ouvert **seulement** depuis `172.30.10.0/24`.
- [ ] L'API d'Hermès est fermée depuis Internet : sur ton ordinateur, `curl -m 5 http://<adresse-IP>:8642/health` doit **échouer** (délai dépassé). Si tu obtiens `{"status": "ok"}`, arrête tout et va voir « Si ça ne marche pas ».
- [ ] Une sauvegarde à la main fonctionne :

  ```bash
  sudo bash /opt/jsquare/deploy/scripts/sauvegarde.sh
  sudo cat /var/backups/jsquare/derniere-sauvegarde.txt
  ```

  **Tu vois** `Tout est OK.`
- [ ] Dans Supabase, **Allow new users to sign up** est éteint.
- [ ] n8n te demande un code à 6 chiffres à la connexion (double authentification, étape 5.5).
- [ ] Un faux événement Stripe non signé reçoit `401` (étape 7.4).

Bravo, le cockpit est en ligne.

### Ce que les deux workflows ne remplissent pas (encore)

Les deux workflows de ce dépôt remplissent le cash (`paiements`, `abonnements`), les fiches clients, la file « À valider » (impayés), le journal, le rapport du soir et l'état de l'agent `reporter`. Les tables suivantes ne se remplissent **pas toutes seules** pour l'instant : il faudra de futurs workflows (agents de prospection, finance…), ou les remplir à la main dans **Supabase > Table Editor**.

| Table | Ce qu'elle montre dans le cockpit | En attendant |
|---|---|---|
| `appels` | les écrans d'appel (« 0 / 100 appels aujourd'hui », leads, rappels) | vide : la salle affiche 0. Jay ou Junior peuvent ajouter des lignes sur leur propre marché. |
| `objectifs` | l'objectif de cash et de clients du mois | sans ligne, le nombre de clients visé vient du réglage `objectif_mensuel` (6 et 6). Ajoute une ligne par mois et par marché si tu veux un objectif de cash. |
| `couts` | les coûts déduits avant le partage 50/50 | ajoute chaque mois tes coûts (serveur, Supabase, crédits Claude…), sinon le partage les ignore. |
| `agents_etat` | les voyants des agents autres que le reporter | vides tant que ces agents n'existent pas. |
| `actions` | propositions des agents (autres que les impayés) | Hermès propose dans la messagerie ; la table se remplira avec les futurs workflows. |

Ces salles restent donc vides ou à zéro au début : ce n'est pas une panne.

---

## Sauvegardes

**Ce qui est sauvegardé chaque nuit à 03:30** (dans `/var/backups/jsquare/`, lisible par l'administrateur seulement) :

| Quoi | Contenu |
|---|---|
| n8n | workflows, identifiants (chiffrés), historique des exécutions |
| Caddy | certificats HTTPS |
| `deploy/.env` | tous les réglages et les clés du serveur |
| Hermès | sa configuration, sa mémoire, ses sessions et ses clés (commande officielle `hermes backup`) |

- n8n est arrêté **quelques secondes** pendant la copie, pour que sa base soit propre. Stripe renvoie tout seul les paiements arrivés pendant ce temps.
- Les sauvegardes de plus de **14 jours** sont effacées.
- **La base Supabase** (clients, paiements, messages…) n'est pas sur le serveur : elle est sauvegardée chaque jour par Supabase (offre Pro, **Database > Backups**).

**Vérifier que la sauvegarde tourne** :

```bash
sudo cat /var/backups/jsquare/derniere-sauvegarde.txt
sudo ls -lh /var/backups/jsquare
```

**Garder une copie hors du serveur** (une fois par semaine, c'est bien) : sur le serveur,

```bash
sudo cp "$(sudo ls -t /var/backups/jsquare/jsquare-*.tar.gz | head -n1)" ~/sauvegarde-jsquare.tar.gz
sudo chown jay ~/sauvegarde-jsquare.tar.gz
```

puis sur ton ordinateur :

```bash
scp jay@<adresse-IP>:sauvegarde-jsquare.tar.gz .
```

et enfin, sur le serveur : `rm ~/sauvegarde-jsquare.tar.gz`. Ce fichier contient tes clés : range-le dans un endroit chiffré (coffre de ton gestionnaire de mots de passe, disque chiffré).

**Restaurer** (après une erreur, ou sur un nouveau serveur après les étapes 5.1 à 5.3 et 6.2) :

```bash
sudo ls -lt /var/backups/jsquare
sudo bash /opt/jsquare/deploy/scripts/restaurer.sh /var/backups/jsquare/<nom-de-l-archive>.tar.gz
```

Le script montre ce que contient l'archive et demande de taper `oui`. Il remet `.env` (l'ancien est gardé à côté), les données de n8n et de Caddy, relance les services, puis restaure Hermès.

## Mises à jour

- **Le code du cockpit** (après une modification dans GitHub) :

  ```bash
  cd /opt/jsquare && git pull && cd deploy && docker compose restart cockpit
  ```

- **n8n** : la version est fixée dans `docker-compose.yml` (`n8nio/n8n:2.41.6`). Pour changer, fais d'abord une sauvegarde, modifie le numéro (`nano docker-compose.yml`), puis `docker compose pull n8n && docker compose up -d n8n`.
- **Hermès** : `sudo -iu hermes env XDG_RUNTIME_DIR=/run/user/$(id -u hermes) hermes update`.
- **Ubuntu** : les mises à jour de sécurité s'installent seules. Si `ssh` affiche `*** System restart required ***`, redémarre un soir : `sudo reboot`. Tout repart tout seul.

## Si ça ne marche pas

Commencer toujours par regarder l'état et les messages :

```bash
cd /opt/jsquare/deploy
docker compose ps
docker compose logs --tail 50 <service>     # caddy, n8n, cockpit ou relais-hermes
```

| Ce que tu vois | Ce qu'il faut faire |
|---|---|
| `nslookup` ne donne pas l'IP du serveur | Les entrées DNS de l'étape 2 sont fausses ou pas encore actives. Vérifie le type (**A**), le sous-domaine et l'IP ; attends jusqu'à une heure. |
| Le navigateur dit « connexion non sécurisée » ou « site inaccessible » | `docker compose logs caddy` : un message `challenge failed` ou `no such host` veut dire que le DNS n'est pas bon (étape 2, et pas d'entrée **AAAA** parasite). Une fois corrigé : `docker compose restart caddy`. |
| `docker compose up` dit `Remplis DOMAINE dans deploy/.env` | Le fichier de réglages n'est pas rempli : relance `bash /opt/jsquare/deploy/scripts/configurer.sh`. |
| `permission denied` en tapant une commande `docker` | Tu n'es pas reconnecté depuis `installer-vps.sh` : `exit`, puis `ssh jay@<adresse-IP>`. |
| Le cockpit affiche le bandeau « Données d'exemple » | Les clés Supabase sont vides. `bash /opt/jsquare/deploy/scripts/configurer.sh --supabase`, puis `docker compose up -d cockpit`. |
| À la connexion : « Ton compte n'a pas encore accès au cockpit » | La ligne `profils` manque : refais l'étape 3.5 avec l'adresse e-mail exacte. |
| À la connexion : identifiants refusés | Essaie « Mot de passe oublié ? ». Sinon, dans Supabase, **Authentication > Users** : le compte existe-t-il, est-il confirmé ? Au besoin, supprime-le et recrée-le (étape 3.4), puis refais l'étape 3.5. |
| Le lien « Mot de passe oublié » ouvre une page d'erreur ou `localhost` | Étape 3.3 : **Site URL** et **Redirect URLs** doivent contenir `https://cockpit.<ton-domaine>`. |
| Dans la messagerie : « Hermès n'est pas encore branché sur ce cockpit » | `HERMES_API_KEY` est vide : relance `configurer.sh`, puis `docker compose up -d cockpit`. |
| Dans la messagerie : « Hermès ne répond pas, réessaie dans un instant » | Suis les 4 contrôles ci-dessous, dans l'ordre. |
| Mot de passe n8n oublié | `bash /opt/jsquare/deploy/scripts/configurer.sh --mot-de-passe-n8n`, puis `docker compose up -d n8n`. |
| n8n : « The request was blocked because it resolves to a restricted IP address » | Une adresse interne est utilisée dans un nœud. Pour Hermès, l'adresse doit être exactement `http://host.docker.internal:8642`. |
| n8n : les événements Stripe sont refusés (401) | Le **Signing secret** de l'identifiant `Stripe J-Square` n'est pas celui du webhook créé par n8n (étape 7.4). |
| Le rapport de 23 h n'est pas arrivé | n8n > **Executions** : ouvre l'exécution rouge, le nœud rouge dit ce qui bloque (souvent Hermès, voir ci-dessous). |
| `installer-hermes.sh` s'arrête sur « Hermès a encore des outils dangereux sur l'API » | Le service est arrêté exprès. Relance `sudo bash /opt/jsquare/deploy/scripts/installer-hermes.sh` : il remet la liste d'outils de `deploy/hermes/config.yaml`. N'ajoute jamais `terminal`, `file`, `code_execution`, `web` ou `browser` à Hermès : son compte garde le jeton Supabase (`sbp_…`) qui ouvre tout ton compte. |
| Une fiche client manque dans la salle **Clients** | Le client n'a pas encore payé d'abonnement, ou il payait avant la mise en ligne : crée sa fiche à la main (étape 4.3) avec son `stripe_customer_id`. |
| `derniere-sauvegarde.txt` est vieux de plus d'un jour | `sudo tail -n 30 /var/log/jsquare-sauvegarde.log` montre l'erreur. Disque plein ? `df -h /`. |

**Hermès ne répond pas : les 4 contrôles**

1. Hermès tourne-t-il ?

   ```bash
   curl -s http://127.0.0.1:8642/health
   ```

   Attendu : `{"status": "ok"}`. Sinon, relance-le avec `sudo bash /opt/jsquare/deploy/scripts/installer-hermes.sh` (il ne réinstalle rien, il vérifie et redémarre), et regarde ses messages : `sudo journalctl _UID=$(id -u hermes) -n 50`.
2. Le relais tourne-t-il ?

   ```bash
   docker compose logs --tail 20 relais-hermes
   ```

   Attendu : `Relais Hermès prêt : 172.17.0.1:8642 -> 127.0.0.1:8642`. Si tu vois `EADDRNOTAVAIL`, l'adresse du pont Docker n'est pas celle de `.env` : relance `configurer.sh` (il la corrige), puis `docker compose up -d relais-hermes`.
3. Le pare-feu laisse-t-il passer les conteneurs ?

   ```bash
   sudo ufw status | grep 8642
   ```

   Attendu : `8642/tcp  ALLOW  172.30.10.0/24`. Sinon, relance `sudo bash /opt/jsquare/deploy/scripts/installer-vps.sh`.
4. Le cockpit joint-il Hermès ?

   ```bash
   docker compose exec cockpit node -e "fetch('http://host.docker.internal:8642/health').then(r=>r.text()).then(console.log,console.error)"
   ```

   Attendu : `{"status": "ok"}`.

Si `curl http://<adresse-IP>:8642/health` répond **depuis ton ordinateur**, l'API est exposée : arrête-la tout de suite (`docker compose stop relais-hermes`), puis vérifie `API_SERVER_HOST=127.0.0.1` dans `/home/hermes/.hermes/.env` (`sudo cat` pour le lire) et relance `installer-hermes.sh`.

---

## Annexe : les fichiers de ce dossier

| Fichier | Rôle |
|---|---|
| `docker-compose.yml` | les 4 services : `caddy` (HTTPS), `n8n` (version figée), `cockpit` (Node 22, lance `cockpit/app/server.js`, code en lecture seule) et `relais-hermes` |
| `Caddyfile` | `cockpit.<domaine>` et `n8n.<domaine>`, certificats automatiques, en-têtes de sécurité |
| `.env.example` | le modèle de tous les réglages, expliqués un par un (le vrai fichier `.env` est créé par `configurer.sh` et n'est jamais dans git) |
| `hermes/config.yaml` | réglages d'Hermès : modèle Claude, fuseau, garde-fous, Supabase en lecture seule |
| `hermes/env.example` | modèle de ses secrets (`~/.hermes/.env` du compte `hermes`) |
| `hermes/SOUL.md` | ses consignes de rôle : le centre de J-Square |
| `hermes/relais-hermes.js` | le relais conteneurs → Hermès |
| `scripts/installer-vps.sh` | préparation du serveur (relançable) |
| `scripts/configurer.sh` | création et complément de `.env` (relançable) |
| `scripts/installer-hermes.sh` | installation et réglage d'Hermès (relançable) |
| `scripts/sauvegarde.sh`, `scripts/restaurer.sh` | sauvegarde de chaque nuit et restauration |

**Pour les développeurs** : les tests du kit se lancent depuis la racine du dépôt avec `node --test deploy/test/*.test.js`. Les tests de Caddy, de `configurer.sh` et shellcheck ne tournent que si `CADDY_BIN` et `SHELLCHECK_BIN` pointent vers ces binaires (sinon ils sont passés) ; le test du SQL du guide a besoin d'un Postgres local (comme `supabase/tests/run.sh`).
