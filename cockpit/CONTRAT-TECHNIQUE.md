# Contrat technique du cockpit J-Square (v1)

Toutes les briques (base Supabase, serveur du cockpit, interface, workflows n8n, déploiement) suivent ce contrat. Un nom de table, de colonne, de vue, de fonction, d'endpoint ou de variable d'environnement ne change ici qu'avec une mise à jour de ce fichier.

Langue : noms en français, sans accents, en snake_case. Montants en unités de la devise (390.00 = 390 €), type `numeric(12,2)`. Dates en `timestamptz`, affichées à l'heure du marché (France : Europe/Paris ; US : America/New_York par défaut).

## 0. Arborescence

```
supabase/
  migrations/20261003000000_cockpit.sql   schéma, RLS, fonctions, vues
  seed_demo.sql                           données d'exemple (jamais en production)
  tests/                                  tests SQL sur un Postgres local (schéma auth simulé)
cockpit/app/
  server.js                               serveur Node 22 sans dépendance
  public/index.html, app.js, style.css    interface (connexion + tour de contrôle)
  public/demo.js                          données d'exemple pour le mode démo
  test/                                   tests node:test et Playwright
n8n/
  stripe-mapping.js                       fonction pure : événement Stripe → lignes
  build.js                                génère les JSON de workflows à partir des .js
  workflows/stripe-vers-supabase.json
  workflows/rapport-du-soir.json
  test/
deploy/
  docker-compose.yml, Caddyfile, .env.example, hermes/, README.md
```

## 1. Base Supabase (Postgres 15+)

Extensions : `pgcrypto` (gen_random_uuid). Toutes les tables du schéma `public` ont RLS activée.

### 1.1 Rôles applicatifs

Deux associés seulement. Toute personne connectée sans ligne dans `profils` ne voit rien.

- `profils` : `id uuid primary key references auth.users(id) on delete cascade`, `nom text not null`, `role text not null check (role in ('admin','associe'))`, `marche text check (marche in ('fr','us'))`, `cree_le timestamptz default now()`.
  - Jay : role `admin`, marche `fr`.
  - Junior : role `associe`, marche `us`.
- Fonctions `security definer`, `stable`, avec `set search_path = public` :
  - `est_membre() returns boolean` : il existe un profil pour `auth.uid()`.
  - `est_admin() returns boolean` : ce profil a le rôle `admin`.
  - `mon_marche() returns text` : le marché de ce profil.

### 1.2 Tables

| Table | Colonnes (en plus de `id uuid pk default gen_random_uuid()` sauf mention) | Écrit par |
|---|---|---|
| `reglages` | `cle text pk` (pas d'id), `valeur jsonb not null`, `maj timestamptz default now()` | admin |
| `clients` | `marche text not null check in ('fr','us')`, `nom text not null`, `niche text`, `palier text`, `prix_mensuel numeric(12,2)`, `devise text not null check in ('EUR','USD')`, `mise_en_place numeric(12,2) default 0`, `debut date`, `fin_engagement date`, `objectif_garantie text`, `objectif_valeur numeric`, `resultat_valeur numeric default 0`, `prochain_point timestamptz`, `point_booke boolean default false`, `stripe_customer_id text unique`, `statut text default 'actif' check in ('actif','pause','termine')`, `owner_id uuid references profils(id) default auth.uid()`, `cree_le`, `maj` | associé (ses lignes, sur son marché) ou admin ; n8n crée la fiche d'un client abonné (`on_conflict=stripe_customer_id`, jamais écrasée). `stripe_customer_id` : posé ou changé seulement par l'admin ou n8n |
| `abonnements` | `stripe_subscription_id text unique not null`, `stripe_customer_id text`, `client_id uuid references clients(id)`, `marche text check in ('fr','us')`, `statut text not null` (statut Stripe : active, trialing, past_due, canceled, unpaid, incomplete…), `montant numeric(12,2) not null` (montant par facture), `devise text not null`, `intervalle_mois int not null default 1` (3 pour un pack trimestriel), `debut timestamptz`, `fin_engagement timestamptz`, `prochaine_facture timestamptz`, `annule_le timestamptz`, `maj timestamptz default now()` | n8n seulement |
| `paiements` | `stripe_event_id text unique not null`, `stripe_invoice_id text`, `stripe_customer_id text`, `client_id uuid references clients(id)`, `marche text not null check in ('fr','us')`, `type text not null check in ('abonnement','mise_en_place','pack','ponctuel','remboursement','litige')`, `montant numeric(12,2) not null` (négatif pour un remboursement ou un litige), `devise text not null check in ('EUR','USD')`, `taux_eur numeric(12,6) not null default 1` (euros pour 1 unité de devise), `montant_eur numeric(12,2) generated always as (round(montant * taux_eur, 2)) stored`, `paye_le timestamptz not null`, `description text`, `cree_le timestamptz default now()` | n8n seulement |
| `objectifs` | `mois date not null` (1ᵉʳ du mois), `marche text not null check in ('fr','us')`, `clients_vises int not null`, `cash_vise numeric(12,2) not null`, `devise text not null`, `calcule_par text`, `maj`, contrainte unique `(mois, marche)` | admin ; agent finance via n8n |
| `couts` | `mois date not null`, `poste text not null`, `montant_eur numeric(12,2) not null`, unique `(mois, poste)` | admin ; n8n |
| `appels` | `marche text not null check in ('fr','us')`, `ecran text not null` (ex. `standard`, `acquisition`, `us_floride`), `lead_ref text not null`, `statut text`, `note text`, `rappel_le timestamptz`, `maj timestamptz`, `owner_id uuid references profils(id)`, unique `(ecran, lead_ref)` | n8n (synchro du soir) ; associé (ses lignes, sur son marché) |
| `actions` | `marche text check in ('fr','us')` (null = les deux), `agent text not null`, `type_action text not null`, `titre text not null`, `details jsonb default '{}'`, `statut text not null default 'en_attente' check in ('en_attente','validee','refusee','executee','erreur')`, `auto boolean default false` (exécutée sans validation grâce à l'autonomie), `cree_le`, `decide_par uuid references profils(id)`, `decide_le timestamptz`, `correction text` | n8n et Hermès créent ; décision seulement par `decider_action` |
| `autonomie` | pk `(agent, type_action)` (pas d'id), `niveau int not null default 0 check (niveau between 0 and 2)` (0 = toujours demander, 1 = autonome après 5 OK, 2 = autonome), `verrou boolean not null default false` (argent, prix, contrat, premier message à un client : niveau 0 obligatoire), `ok_consecutifs int not null default 0`, `maj` | seulement par `changer_autonomie` et par le trigger de `actions` |
| `messages` | `auteur text not null check in ('jay','junior','hermes','systeme')`, `auteur_id uuid references profils(id)`, `marche text check in ('fr','us')`, `type text not null default 'message' check in ('message','rapport','alerte')`, `contenu text not null check (char_length(contenu) <= 8000)`, `meta jsonb default '{}'`, `cree_le timestamptz default now()` | associé (ses messages) ; serveur et n8n (Hermès, système) |
| `rapports` | `jour date unique not null`, `verdict text not null check in ('tenir','ajuster_prix','changer_niche','changer_offre','alerte')`, `resume text not null`, `contenu text not null`, `donnees jsonb default '{}'`, `cree_le` | n8n |
| `agents_etat` | `agent text pk` (pas d'id), `nom text not null`, `marche text`, `statut text not null check in ('run','wait','idle','ok','err')`, `derniere_phrase text`, `derniere_execution timestamptz`, `prochaine_execution timestamptz`, `cout_jour_eur numeric(10,2) default 0`, `maj` | n8n et Hermès |
| `journal` | `marche text` (null = les deux), `agent text not null`, `texte text not null`, `cree_le timestamptz default now()` | n8n, Hermès, triggers |

Index : `paiements(paye_le)`, `paiements(marche, paye_le)`, `journal(cree_le desc)`, `messages(cree_le desc)`, `messages(auteur_id, cree_le desc)`, `actions(statut, cree_le)`.

Triggers de liaison et de garde (en plus de `maj`) :
- `relier_client` (avant insert/update sur `paiements` et `abonnements`) : remplit `client_id` d'après `stripe_customer_id`.
- `rattacher_historique_client` (après insert, ou update de `stripe_customer_id`, sur `clients`) : rattache à la fiche les paiements et abonnements déjà reçus pour ce `stripe_customer_id` et encore sans `client_id`.
- `clients_avant_ecriture` : refuse (42501) qu'une personne non admin pose ou change `stripe_customer_id` ; une fiche insérée sans `owner_id` (n8n) reçoit l'associé dont `profils.marche` = `clients.marche`.
- `messages_avant_ajout` : pour un message de `jay` ou `junior` écrit par une personne connectée, `cree_le := now()` et au plus 30 messages par minute et par `auteur_id` (au-delà : erreur P0001).

### 1.3 Valeurs de `reglages` (insérées par la migration)

- `seuils` :
  ```json
  {
    "tva_base": 37500, "tva_majore": 41250, "plafond_micro": 83600,
    "date_creation": "2026-08-01", "annee_seuils": 2026
  }
  ```
- `cotisations` : `{"taux": 0.256, "regime": "BNC"}`. **À confirmer** sur l'avis de situation SIRENE.
- `change` : `{"usd_eur": 0.891, "source": "BCE 2026-10-02"}`. Taux de secours si n8n n'en fournit pas.
- `objectif_mensuel` : `{"fr": 6, "us": 6}` (nouveaux clients par mois).
- `partage` : `{"jay": 0.5, "junior": 0.5, "base": "apres_cotisations_et_couts"}`.

### 1.4 RLS

- **Lecture (SELECT)** sur toutes les tables et vues : `using (est_membre())`.
- **Écriture par une personne connectée** :
  - `clients`, `appels` : INSERT/UPDATE/DELETE avec `est_admin() or (owner_id = auth.uid() and marche = mon_marche())` (`with check` identique).
  - `messages` : INSERT seulement si `auteur_id = auth.uid()`, que `auteur` vaut `'jay'` pour l'admin ou `'junior'` pour l'associé, que `type = 'message'` et que `meta` est vide (`{}`). Pas d'UPDATE ni de DELETE. La date et le débit sont gardés par le trigger `messages_avant_ajout`.
  - `reglages`, `objectifs`, `couts` : INSERT/UPDATE si `est_admin()`.
  - Toutes les autres tables (`paiements`, `abonnements`, `actions`, `autonomie`, `rapports`, `agents_etat`, `journal`, `profils`) : aucune politique d'écriture. Seule la clé secrète (n8n, serveur) ou une fonction `security definer` y écrit.
- **Vues** : `with (security_invoker = true)`.
- **Droits** : `revoke all on all tables in schema public from anon` ; `anon` ne voit rien.

### 1.5 Fonctions RPC (security definer, `set search_path = public`)

- **`decider_action(p_id uuid, p_ok boolean, p_correction text default null) returns actions`**
  - Refuse si la personne n'est pas membre.
  - Refuse si l'action n'est pas `en_attente`.
  - Refuse si la personne n'est ni admin ni du marché de l'action (une action sans marché demande l'admin).
  - Met `statut` à `validee` ou `refusee`, avec `decide_par`, `decide_le` et `correction`.
  - Met à jour `autonomie`, en créant la ligne si besoin (niveau 0) :
    - validée sans correction **par l'admin** : `ok_consecutifs + 1` (l'autonomie est commune aux deux marchés : un OK de l'associé ne la fait pas monter, sinon les OK de Junior sur les USA rendraient autonomes les actions France) ;
    - validée sans correction par l'associé : compteur inchangé ;
    - refusée ou corrigée (par n'importe qui) : `ok_consecutifs = 0`, et `niveau = greatest(niveau - 1, 0)`.
  - Écrit une ligne dans `journal`.
- **`type_action_verrouille(p_type text) returns boolean`** : vrai pour les actions toujours soumises à validation. Le type est normalisé (minuscules, sans accents, séparateur `_`), puis comparé à la liste `relance_impaye`, `changer_prix`, `envoyer_argent`, `rembourser`, `mission_apify`, `envoyer_contrat`, `signer_contrat`, `premier_message`, et à des familles de mots : `rembours…`, `payer`, `paiement`, `virement`, `argent`, `impaye`, `litige`, `contrat`, `apify`, `premier_message`, ou un verbe de changement (`changer`, `modifier`, `baisser`, `monter`, `augmenter`, `reduire`, `fixer`, `appliquer`) suivi de `prix`, `tarif` ou `remise`.
- **`changer_autonomie(p_agent text, p_type text, p_niveau int) returns autonomie`**
  - Admin seulement.
  - Refuse un niveau supérieur à 0 si `verrou` ou si `type_action_verrouille(p_type)` (la ligne est alors verrouillée).
  - Remet `ok_consecutifs` à 0.
- **`promotion_possible` (vue)** : lignes d'`autonomie` où `verrou = false`, `niveau < 2` et `ok_consecutifs >= 5`. Hermès les propose, Jay décide.

### 1.6 Vues de cash (montants en devise du marché, et en euros pour le total)

« Mois courant » = mois en cours à Europe/Paris (`date_trunc('month', now() at time zone 'Europe/Paris')`).

- **`v_cash_mensuel`** : `marche`, `mois date`, `devise`, `montant numeric`, `montant_eur numeric`, `nb_paiements int`. Somme de `paiements` par marché et par mois de `paye_le` à Europe/Paris.
- **`v_cash_resume`** : une ligne par `marche` (`'fr'`, `'us'`, `'total'`).
  - Colonnes de cash : `devise` (`EUR` pour fr et total, `USD` pour us), `cash_mois`, `cash_mois_eur`, `cumul`, `cumul_eur`, `premier_paiement date`.
  - Récurrent : `mrr` et `mrr_eur`, soit la somme de `montant / intervalle_mois` des abonnements `active`, `trialing` ou `past_due`.
  - Objectif du mois : `objectif_cash` et `objectif_clients` (depuis `objectifs`), `clients_signes_mois` (clients dont `debut` est dans le mois courant).
  - Le total convertit les USD avec `taux_eur` pour les paiements, et avec `reglages.change.usd_eur` pour le MRR et l'attendu.
- **`v_cash_attendu`** : `marche`, `mois date` (les 3 mois après le mois courant), `devise`, `engage numeric`, `probable numeric`, plus `engage_eur`, `probable_eur`. Pour chaque abonnement actif, et chaque date de facture future (`prochaine_facture` + k × `intervalle_mois`) qui tombe dans l'un des 3 mois :
  - si `fin_engagement` est nulle ou si la date est avant `fin_engagement`, le montant compte dans `engage` ;
  - sinon, dans `probable` (renouvellement possible).
  - Inclut aussi la ligne `marche = 'total'` en euros.
- **`v_cash_cumul`** : `marche` (fr, us, total), `jour date`, `cumul`, `cumul_eur`, pour tracer la courbe en escalier (un point par jour avec paiement).
- **`v_seuils`** : une ligne pour l'année civile en cours, à Europe/Paris.
  - CA : `annee int`, `ca_france_eur` (paiements fr de l'année), `ca_total_eur` (fr + us).
  - Prorata : `jours_activite int`, égal à 365 (366 les années bissextiles), sauf l'année de `date_creation`, où il vaut le nombre de jours de `date_creation` au 31/12 inclus.
  - Seuils : `tva_base`, `tva_majore`, `plafond_micro`, chacun multiplié par `jours_activite / jours_de_l_annee`.
  - Alertes : `alerte_tva text` (`ok`, `proche` à 80 % du seuil de base, `base_depassee`, `tva_due`) et `alerte_micro text` (`ok`, `proche` à 80 %, `depasse`).
- **`v_partage`** : mois courant et cumul de l'année.
  - Calcul : `cash_eur`, `cotisations_eur` (cash × taux), `couts_eur` (table `couts`), `resultat_eur` (cash − cotisations − coûts), `part_jay_eur`, `part_junior_eur`.
  - Le partage se fait sur le résultat, jamais sur le cash.

## 2. Serveur du cockpit (`cockpit/app/server.js`)

Node 22, aucune dépendance npm. Il écoute sur `PORT` (défaut 8080) et sert `public/`. En-têtes de sécurité : CSP stricte (scripts : self et **le seul fichier** supabase-js figé de la section 3, pas tout cdn.jsdelivr.net ; connexions : self et `SUPABASE_URL` en https/wss ; polices : Google Fonts), `X-Frame-Options: DENY` et `Referrer-Policy: same-origin`.

### Variables d'environnement

| Variable | Rôle |
|---|---|
| `PORT` | port d'écoute |
| `SUPABASE_URL` | URL du projet |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`, envoyée au navigateur |
| `SUPABASE_SECRET_KEY` | `sb_secret_…`, reste sur le serveur |
| `HERMES_URL` | `http://host.docker.internal:8642` par défaut |
| `HERMES_API_KEY` | clé de l'API Hermès |
| `HERMES_MODEL` | `hermes-agent` par défaut |
| `DEMO` | `1` pour forcer le mode démo |

### Endpoints

- **`GET /api/config`** → `{ "supabaseUrl", "supabasePublishableKey", "hermes": true|false, "demo": true|false }`. Jamais de secret.
- **`GET /healthz`** → `{ "ok": true }`.
- **`POST /api/hermes/chat`**
  - En-tête `Authorization: Bearer <access_token Supabase>`. Corps : `{ "message": string (1 à 4000 caractères), "marche": "fr"|"us"|null }`.
  0. Avant toute vérification : au plus 30 demandes par minute et par adresse IP (derrière Caddy, la dernière entrée de `X-Forwarded-For`), et 120 vérifications de jeton par minute pour tout le serveur ; au-delà, 429.
  1. Vérifie le jeton avec `GET {SUPABASE_URL}/auth/v1/user` (apikey = clé publishable) : 401 si le jeton est invalide.
  2. Lit le profil avec le jeton de la personne (`GET /rest/v1/profils?id=eq.<uid>`) : 403 s'il n'y a pas de profil.
  3. Insère le message de la personne dans `messages` avec son propre jeton, donc sous RLS (`auteur` = `jay` si admin, sinon `junior`).
  4. Lit les 20 derniers messages.
  5. Appelle `POST {HERMES_URL}/v1/chat/completions` (OpenAI-compatible, `Authorization: Bearer HERMES_API_KEY`, `model: HERMES_MODEL`). Le message système rappelle qui parle, son marché, et qu'aucune action réelle ne part sans passer par la table `actions`. Chaque message de Jay ou Junior (historique et message en cours) part encadré : `<message auteur="jay|junior">texte</message>`, avec `&`, `<` et `>` échappés dans le texte ; le message système dit que seul l'attribut `auteur` indique qui parle.
  6. Insère la réponse (`auteur` = `hermes`) avec la clé secrète.
  7. Répond `{ "reply": string, "messageId": uuid }`.
  - Erreurs : 401 jeton invalide, 403 sans profil, 400 corps invalide, 429 au-delà de 20 messages par minute et par personne (ou des limites de l'étape 0), 502 si Hermès ne répond pas (le message de la personne reste enregistré, la réponse indique « Hermès ne répond pas, réessaie dans un instant »), 503 si `HERMES_API_KEY` est absente.
  - Le jeton et la clé ne sont jamais écrits dans les logs.

## 3. Interface (`cockpit/app/public/`)

- **Design** : celui de `cockpit/tour-de-controle.html` (tokens, salles, conduits animés, noyau cash à 3 écrans, messagerie Hermès, journal). Thème clair et sombre, mobile.
- **Client Supabase** : `supabase-js` v2 en UMD depuis `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js` (version figée).
- **Connexion** : e-mail et mot de passe (`signInWithPassword`), et bouton « Mot de passe oublié » (`resetPasswordForEmail`). Pas d'inscription publique : les comptes sont créés par Jay dans Supabase.
- **Après connexion** : station par défaut selon `profils.marche` (Jay arrive au QG, Junior à la station USA) ; tout le monde peut voir les trois.
- **Données lues** :
  - `v_cash_resume`, `v_cash_attendu`, `v_cash_cumul`, `v_seuils`, `v_partage` ;
  - `clients`, `actions` (en attente), `autonomie`, `messages` (50 derniers), `rapports` (dernier), `agents_etat`, `journal` (30 derniers), `objectifs`, `appels` (comptes par écran et par statut).
- **Temps réel** : abonnements Supabase Realtime sur `paiements`, `actions`, `messages`, `journal`, `agents_etat`. Un nouvel événement déclenche le paquet animé de la salle concernée vers le noyau, puis rafraîchit les chiffres.
- **Actions** :
  - Valider ou refuser : `rpc('decider_action', …)`, avec un champ « correction » facultatif.
  - Niveaux d'autonomie : `rpc('changer_autonomie', …)`, visibles pour tous, modifiables par l'admin seulement.
  - Envoyer un message à Hermès : `POST /api/hermes/chat`.
- **Mode démo** : quand `/api/config` renvoie `demo: true`, ou avec `?demo` dans l'URL, l'interface montre les données d'exemple de la maquette avec le bandeau « Données d'exemple », sans connexion.
- **États vides** : une base sans paiement affiche « 0 € » et un texte qui explique d'où viendra le cash (Stripe via n8n), jamais de fausses données.

## 4. n8n

- **`stripe-vers-supabase`** :
  - Stripe Trigger, avec le secret de signature obligatoire, sur les événements `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded` et `charge.dispute.created`.
  - Un nœud Code applique `stripe-mapping.js` (une fonction pure, testée) :
    - `invoice.paid` donne 1 à n lignes `paiements` : les lignes de mise en place deviennent `type = 'mise_en_place'`, un abonnement avec `intervalle_mois = 3` devient `pack` ;
    - le marché vient des `metadata.marche` du client Stripe, ou à défaut de la devise (USD donne us) ;
    - les montants passent des centimes Stripe aux unités.
  - Puis HTTP Request vers `POST {SUPABASE_URL}/rest/v1/paiements?on_conflict=stripe_event_id` avec `Prefer: resolution=ignore-duplicates`, et `abonnements` en upsert sur `stripe_subscription_id`.
  - Fiche client : pour `invoice.paid` d'un abonnement, et pour `customer.subscription.created` actif ou en essai, la sortie `clients` contient une ligne (`stripe_customer_id`, `marche`, `nom`, `devise`, `prix_mensuel`, `debut`, `fin_engagement`), écrite **avant** les paiements par `POST /rest/v1/clients?on_conflict=stripe_customer_id` avec `Prefer: resolution=ignore-duplicates` (une fiche existante n'est jamais écrasée).
  - Une ligne est ajoutée dans `journal`.
  - `invoice.payment_failed` crée une `actions` (type `relance_impaye`, verrouillée), et rien d'autre.
- **`rapport-du-soir`** :
  - Schedule à 23:00 (fuseau Europe/Paris dans les réglages du workflow).
  - HTTP Request vers l'API Hermès (`/v1/chat/completions`). Le prompt demande la synthèse du jour, Hermès lisant Supabase en lecture seule via MCP. Il doit répondre en JSON `{ verdict, resume, contenu, donnees }`, où `donnees` contient les clés `appels_fr`, `joints_fr`, `demos_fr`, `appels_us`, `joints_us`, `demos_us`, `demos_total`, `demos_necessaires` (entiers, ou null si inconnu) ; l'interface lit `demos_total` et `demos_necessaires`.
- **Hors périmètre de ces deux workflows** : `appels`, `objectifs`, `couts`, l'état des agents autres que `reporter`, et les actions autres que `relance_impaye`. Ces tables se remplissent à la main (Table Editor) ou par de futurs workflows ; les salles concernées restent vides ou à zéro jusque-là.
  - Insertion dans `rapports` et dans `messages` (`type = 'rapport'`, `auteur = 'hermes'`).
  - Mise à jour de `agents_etat` pour l'agent `reporter`.
- **Identifiants n8n** : une clé secrète Supabase réservée à n8n, la clé de l'API Hermès, et le secret de signature Stripe.

## 5. Déploiement (VPS OVH, Ubuntu 24.04)

- **`docker-compose.yml`** : services `caddy` (HTTPS automatique), `n8n` (image officielle, version figée, `GENERIC_TIMEZONE=Europe/Paris`) et `cockpit` (node:22-alpine, lance `server.js`).
  - Volumes persistants pour n8n et Caddy.
  - `extra_hosts: host.docker.internal:host-gateway` pour joindre Hermès.
- **Hermès** : installé sur l'hôte avec le script officiel. API sur `127.0.0.1:8642` uniquement, avec `API_SERVER_KEY`. MCP Supabase `https://mcp.supabase.com/mcp?project_ref=<ref>&read_only=true`. Fuseau du serveur : Europe/Paris.
  - Outils : `platform_toolsets.api_server` (et `cron`) = `[mcp-supabase, memory, todo, session_search]` ; `agent.disabled_toolsets` coupe `terminal`, `file`, `code_execution`, `web`, `search`, `browser`, `delegation`, `cronjob`, `computer_use`, `image_gen`, `skills`, `connections`. Le jeton `sbp_…` rangé dans `~/.hermes/.env` ouvre tout le compte Supabase : aucun outil ne doit permettre de lire ce fichier. `installer-hermes.sh` vérifie `GET /v1/toolsets` et arrête le service si un outil dangereux est actif.
- **Domaines** :
  - `cockpit.<domaine>` vers `cockpit:8080` ;
  - `n8n.<domaine>` vers `n8n:5678`, protégé par l'authentification de n8n, avec la double authentification (2FA) activée dès la première connexion.
  - L'API Hermès n'est jamais exposée.
- **Pare-feu** : seuls 22, 80 et 443 sont ouverts.
- **Guide** (`deploy/README.md`), pas à pas en français pour quelqu'un qui n'est pas développeur :
  1. commander le VPS ;
  2. DNS ;
  3. Supabase (projet en région Paris, migration à coller dans l'éditeur SQL, comptes de Jay et Junior, profils) ;
  4. Stripe (webhook, `metadata.marche`, modèles de facture FR et US) ;
  5. `docker compose up` ;
  6. Hermès ;
  7. import des workflows n8n ;
  8. vérification.
