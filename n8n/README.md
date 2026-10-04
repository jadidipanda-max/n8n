# Workflows n8n du cockpit J-Square

Deux workflows à importer dans n8n :

| Workflow | Quand | Ce qu'il fait |
|---|---|---|
| `workflows/stripe-vers-supabase.json` | à chaque événement Stripe | remplit le cash du cockpit (paiements, abonnements, journal) et crée une relance à valider quand un paiement échoue |
| `workflows/rapport-du-soir.json` | tous les soirs à 23:00 (heure de Paris) | demande à Hermès la synthèse du jour, la range dans `rapports` et la poste dans la messagerie |

Il faut **n8n 2.26.2 ou plus récent** : c'est à partir de cette version que le nœud Stripe Trigger vérifie la signature de Stripe et refuse les faux événements.

---

## 1. Créer les 3 identifiants dans n8n (avant l'import)

Dans n8n : menu **Overview → Credentials → Create credential**. Donne-leur **exactement** ces noms : à l'import, n8n relie tout seul chaque nœud à l'identifiant qui porte le bon nom.

| Nom exact | Type à choisir | À remplir |
|---|---|---|
| `Stripe J-Square` | **Stripe API** | **Secret Key** : ta clé secrète Stripe (`sk_live_…`, ou `sk_test_…` pour tester). **Signature Secret** : le secret `whsec_…` du webhook, à copier à l'étape 4. |
| `Supabase n8n (clé secrète)` | **Header Auth** | **Name** : `apikey`. **Value** : une clé secrète Supabase réservée à n8n (`sb_secret_…`). |
| `Hermès API` | **Bearer Auth** | **Bearer Token** : la valeur de `API_SERVER_KEY` dans `~/.hermes/.env` sur le serveur. |

Pour la clé secrète Supabase réservée à n8n : Supabase → **Project Settings → API Keys → Secret keys → New secret key**, nom `n8n`. Si un jour elle fuit, tu la supprimes sans toucher au cockpit.

Pour Stripe, la clé secrète standard suffit. Si tu préfères une clé restreinte (`rk_…`), donne-lui au minimum : Webhook Endpoints en écriture, Customers en lecture, Charges en lecture.

## 2. Importer les workflows

Dans n8n : **Workflows → Create Workflow → menu ⋯ → Import from File…**, choisis `n8n/workflows/stripe-vers-supabase.json`. Recommence avec `n8n/workflows/rapport-du-soir.json`.

Si un nœud reste marqué en rouge après l'import, ouvre-le et choisis l'identifiant dans la liste (c'est qu'un nom ne correspond pas exactement).

## 3. Régler l'adresse de Supabase (et d'Hermès)

Dans chaque workflow, ouvre le nœud **Réglages** :

- `supabaseUrl` : l'adresse de ton projet, par exemple `https://abcdefgh.supabase.co` (Supabase → Project Settings → Data API) ;
- `hermesUrl` (rapport du soir) : `http://host.docker.internal:8642` si Hermès tourne sur le même serveur que n8n ;
- `hermesModel` (rapport du soir) : `hermes-agent`.

Tu peux aussi fabriquer des fichiers déjà réglés avant l'import :

```bash
SUPABASE_URL=https://abcdefgh.supabase.co node n8n/build.js
```

## 4. Stripe : brancher le webhook

1. **Ajoute le marché sur chaque client Stripe.** Stripe → **Clients** → le client → **Métadonnées → Modifier** : clé `marche`, valeur `fr` ou `us`. Sans cette métadonnée, c'est la devise qui décide : un paiement en USD va aux US, tout le reste en France.
2. **Active le workflow `stripe-vers-supabase`** (interrupteur en haut à droite). n8n crée lui-même le webhook dans Stripe, sur les 7 événements utiles, avec la version d'API `2026-08-26.dahlia`. **Ne crée pas de webhook à la main pour ce flux** : il enverrait les événements en double, signés avec un autre secret, et n8n les refuserait.
3. Dans Stripe → **Developers → Webhooks**, ouvre le webhook « Created by n8n for workflow ID … », copie son **Signing secret** (`whsec_…`) et colle-le dans l'identifiant `Stripe J-Square`, champ **Signature Secret**. Avec ça, tout événement non signé par Stripe est refusé (réponse 401).

### Ce que devient chaque événement

| Événement Stripe | Dans Supabase |
|---|---|
| `invoice.paid` | 1 à 3 lignes dans `paiements` : l'abonnement (`abonnement`, ou `pack` si l'abonnement se facture tous les 2 mois ou plus), la mise en place (`mise_en_place`), un éventuel extra (`ponctuel`). Le total est toujours celui que Stripe a encaissé. Plus une ligne dans le `journal`. |
| `invoice.payment_failed` | une action `relance_impaye` dans la file « À valider ». Elle reste toujours soumise à ta validation. Rien d'autre. |
| `customer.subscription.created` / `.updated` / `.deleted` | la ligne de l'abonnement dans `abonnements` (créée ou mise à jour), plus une ligne de journal pour un nouvel abonnement, une résiliation programmée ou annulée, un retard de paiement ou une fin. |
| `charge.refunded` | une ligne `remboursement` en négatif dans `paiements` (seulement la part remboursée cette fois-ci). |
| `charge.dispute.created` | une ligne `litige` en négatif dans `paiements`, et la date limite pour envoyer les preuves dans le journal. |

Les montants passent des centimes Stripe aux euros ou dollars. Un paiement en dollars garde son montant en USD, avec le taux BCE du jour (repli : le réglage `change` de Supabase).

### Réglages facultatifs dans Stripe (métadonnées)

| Où | Clé | Valeur | Effet |
|---|---|---|---|
| Client | `marche` | `fr` ou `us` | marché du client (recommandé pour tous) |
| Abonnement | `fin_engagement` | `2027-01-04` | date de fin d'engagement. Sans rien, l'engagement dure **3 mois** à partir du début de l'abonnement. |
| Abonnement | `engagement_mois` | `6` | autre durée d'engagement, en mois |
| Prix ou ligne de facture | `type_paiement` | `abonnement`, `mise_en_place`, `pack` ou `ponctuel` | force le type d'une ligne si le classement automatique ne convient pas |

Une ligne ponctuelle compte comme `mise_en_place` quand elle est sur la première facture d'un abonnement, ou quand sa description parle de « mise en place » (ou setup, installation, onboarding).

## 5. Tester avec la Stripe CLI (mode test)

1. Mets une clé de test (`sk_test_…`) dans l'identifiant `Stripe J-Square`, puis désactive et réactive le workflow : n8n crée le webhook du mode test.
2. Sur ton ordinateur : installe la [Stripe CLI](https://docs.stripe.com/stripe-cli), puis `stripe login`.
3. Déclenche des événements de test :

   ```bash
   stripe trigger invoice.paid
   stripe trigger invoice.payment_failed
   stripe trigger customer.subscription.updated
   stripe trigger charge.refunded
   stripe trigger charge.dispute.created
   ```

   Stripe crée de vrais objets de test (client, abonnement, facture) et envoie les événements au webhook créé par n8n, signés avec le bon secret.
4. Vérifie :
   - n8n → **Executions** : une exécution verte par événement ;
   - Supabase → Table Editor → `paiements` : les lignes de test finissent par « (test) » dans la description ;
   - le cockpit : le paiement apparaît dans le journal, la relance dans « À valider ».

   Les objets de la CLI sont en dollars, sans métadonnée `marche` : ils arrivent donc côté US. C'est normal.
5. **N'utilise pas** `stripe listen --forward-to …` : la CLI signerait avec son propre secret et n8n refuserait les événements (401).
6. Pour effacer les lignes de test, dans Supabase → SQL Editor :

   ```sql
   delete from paiements where description like '%(test)';
   delete from journal where texte like '%(test)';
   ```

7. Pour passer en réel : remets la clé `sk_live_…`, désactive puis réactive le workflow (n8n crée le webhook du mode réel), et recopie son nouveau **Signing secret** dans l'identifiant.

## 6. Le rapport du soir

1. Active le workflow `rapport-du-soir`. Le fuseau Europe/Paris est déjà dans ses réglages : il part à 23:00, heure de Paris, été comme hiver.
2. Pour l'essayer tout de suite : ouvre-le et clique **Execute workflow**.
3. Hermès lit Supabase en lecture seule (MCP) et doit répondre en JSON `{ "verdict", "resume", "contenu" }`. S'il répond en texte libre, le rapport est gardé tel quel ; le verdict est lu après « Verdict : », sinon c'est « tenir ».
4. Si Hermès ne répond pas (10 minutes au plus), tu reçois une alerte dans la messagerie, l'agent « Rapport du soir » passe en erreur dans le cockpit, et le workflow retente le lendemain. Le relancer à la main le même jour remplace le rapport du jour.

## 7. En cas de problème

- **Une exécution est rouge** dans n8n → ouvre-la : le nœud en rouge dit ce qui bloque (souvent une URL Supabase ou une clé). Une fois corrigé, tu peux la relancer : un paiement déjà enregistré n'est jamais compté deux fois (`stripe_event_id` unique). Seule la ligne de journal peut apparaître deux fois.
- **Le taux BCE ne répond pas** → le workflow prend le taux de secours du réglage `change` dans Supabase, sans rien bloquer.
- **Le client Stripe n'est pas lisible** (supprimé, clé restreinte) → le paiement est quand même enregistré ; le marché est alors choisi par la devise.

---

## Pour les développeurs

- Le code des nœuds Code vient de `stripe-mapping.js` et de `rapport-du-soir.js` (fonctions pures). **Ne modifie pas le code dans n8n** : modifie ces fichiers puis régénère les JSON avec `node n8n/build.js`.
- `node n8n/build.js --verifier` échoue si les JSON ne sont plus à jour.
- Tests : `node --test n8n/test/*.test.js`
  - `mapping.test.js` : événements Stripe réels (factures dans les deux formes de l'API, avant et après `2025-03-31.basil`) ;
  - `rapport.test.js` : demande à Hermès et lecture de sa réponse ;
  - `workflows.test.js` : JSON valides, connexions, synchronisation, et exécution complète des deux workflows dans un petit simulateur de n8n avec de faux Stripe, BCE, Supabase et Hermès ;
  - `postgres.test.js` : les lignes produites entrent dans la vraie migration sur un Postgres local (passé automatiquement si Postgres n'est pas installé) ;
  - `n8n-reel.test.js` (facultatif) : chaque nœud est relu par le vrai code de n8n (versions de nœud connues, aucun paramètre ignoré). Il tourne avec `N8N_MODULES=/chemin/vers/node_modules` après un `npm install n8n` ; sinon il est passé.
- Les deux workflows ont été importés et exécutés avec n8n 2.41.6 (Node 24) contre un faux Supabase et un faux Hermès : identifiants reliés par leur nom à l'import, nœuds Code exécutés dans le « task runner » de n8n, écritures conformes.
- Écritures Supabase (clé secrète, en-tête `apikey`) :
  - `POST /rest/v1/paiements?on_conflict=stripe_event_id` avec `Prefer: resolution=ignore-duplicates` ;
  - `POST /rest/v1/abonnements?on_conflict=stripe_subscription_id` avec `Prefer: resolution=merge-duplicates` ;
  - `POST /rest/v1/rapports?on_conflict=jour` et `agents_etat?on_conflict=agent` en `merge-duplicates` ;
  - `actions`, `journal`, `messages` en simple ajout.
- Un `invoice.paid` qui donne plusieurs lignes utilise `evt_…` pour la ligne principale et `evt_…:mise_en_place` ou `evt_…:ponctuel` pour les autres.
