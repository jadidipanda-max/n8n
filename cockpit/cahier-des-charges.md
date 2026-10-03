# Cockpit J-Square : cahier des charges

État au 3 octobre 2026. Maquette : `cockpit/tour-de-controle.html` (publiée en artifact privé). Ce fichier rassemble les décisions de Jay et les recherches faites pour les prendre. Les points marqués **à valider** attendent une réponse de Jay, de Junior ou d'un expert-comptable.

## 1. Ce que Jay a décidé

- **Style** : tour de contrôle claire et animée. Chaque section est une salle à part, reliée au noyau cash par des conduits où passent les événements.
- **Trois espaces** : station France (Jay), station USA (Junior), et au milieu le QG avec le cash total des deux marchés. Dans une station, on ne voit que les infos de ce marché.
- **Cash au centre**, en trois écrans qu'on fait glisser :
  1. cash collecté du mois, avec « depuis le 1ᵉʳ <mois> » en petit dessous ;
  2. récurrent signé et cash attendu sur les 3 prochains mois (engagements de 3 mois) ;
  3. cumul depuis le début.
- **Objectif** : 6 nouveaux clients par mois en France et 6 par mois aux US. L'agent finance calcule l'objectif de cash de chaque mois.
- **Prix** : les 3 premiers clients France sont des pilotes (190 €/mois). Ensuite, grille du skill `pricing-strategy` : Essentiel 390 €, Croissance 690 €, Premium dès 1 190 €. L'alerte de prix plancher suit les règles de ce skill.
- **Partage** : 50/50 entre Jay et Junior. Tous les paiements passent par le Stripe de J-Square.
- **Rapport du soir** : tous les soirs à 23:00, dans la messagerie du cockpit.
- **Validation** : les agents lisent, calculent, écrivent des rapports et des brouillons seuls. Le reste passe par une file « À valider ». Avec l'entraînement, certaines actions n'auront plus besoin de validation.
- **Hermès** (Hermes Agent, Nous Research) est le centre général : il fait le point avec Jay sur l'avancement de tout.
- **Lead gen** : seulement sur demande. Il reste plus de 850 leads à appeler en France, rien à générer pour l'instant. 100 appels par jour et outreach Facebook tous les jours.
- **Garantie** : un objectif fixé contrat par contrat, sans modèle. S'il n'est pas atteint après les 3 mois d'engagement, on continue gratuitement jusqu'à l'atteindre.

## 2. Les agents

| Agent | Rôle | Seul | Avec validation |
|---|---|---|---|
| **Hermès** (centre) | Orchestre les autres, rapport de 23 h, répond dans la messagerie, propose les promotions d'autonomie | Lire, résumer, relancer un agent | Tout ce qui sort de J-Square |
| **Prospection** (un par marché) | Suit les écrans d'appel, prépare l'outreach Facebook, lance une recherche de leads quand on le demande | Préparer les messages du jour | Toute mission Apify (coût annoncé avant) |
| **Finance** | Tout ce qui est argent : cash, récurrent, objectifs du mois, prix après les pilotes, plancher, seuils TVA et micro, partage, coûts, marges | Calculer, alerter | Changer un prix, toute facture au début |
| **Paperasse** | Propositions, contrats, factures, signatures | Préparer les brouillons | Envoyer quoi que ce soit au client |
| **Suivi clients** (nouveau) | Contrats en cours, date de début et de fin d'engagement, ce qu'on a généré, objectif de garantie, points mensuels bookés dans l'agenda de chacun | Booker les points mensuels | Envoyer le rapport mensuel au client |
| **Reporter** | Synthèse quotidienne de toute la data, croisée chaque jour avec des sources externes. Juge s'il faut changer de trajectoire ou de prix | Écrire le rapport | Rien : il recommande seulement |
| **Researcher** | Rentabilité : offres, nouveautés IA, impôts et structure, quand prendre un setter, un closer, embaucher | Chercher, résumer | Rien : il recommande seulement |

**Autonomie qui grandit.** Chaque action passe d'abord par la file « À valider » (niveau « toujours me demander »). Après 5 OK d'affilée sans correction sur le même type d'action, Hermès propose de passer au niveau suivant, et Jay décide d'un clic. À la première correction, l'action redescend d'un niveau. Envoyer de l'argent, changer un prix, signer un contrat ou écrire à un client pour la première fois restent toujours soumis à validation.

## 3. Architecture recommandée

Trois couches. On ne met jamais d'IA dans le chemin critique d'un rappel ou d'un paiement.

1. **Couche fiable : n8n + Supabase.**
   - Le rappel en moins d'une minute (Vapi), les webhooks Stripe, l'écriture dans le CRM et le calcul du cash restent dans n8n.
   - Supabase (offre Pro, région Paris) devient la seule source de vérité. Tables : `profils`, `clients` (marché FR/US, `owner_id`), `abonnements`, `paiements` (`stripe_event_id` unique pour ignorer les doublons), `leads`, `appels`, `actions` (file à valider), `autonomie`, `messages`, `rapports`.
   - Row Level Security sur toutes les tables : les deux associés lisent tout, chacun n'écrit que ses lignes, Jay est admin. Personne n'écrit les paiements à la main : seul n8n le fait.
2. **Couche cerveau : Hermès sur le VPS.**
   - API uniquement sur 127.0.0.1, avec une clé, derrière le petit serveur du cockpit. Jamais exposée sur Internet, car elle donne accès au terminal du serveur.
   - Lit Supabase en lecture seule (MCP Supabase, `read_only=true`, limité au projet). Écrit ses rapports et ses propositions d'actions par un webhook n8n.
   - Cron « 0 23 * * * », avec le serveur réglé sur Europe/Paris.
   - Modèle : clé API Claude payée à l'usage, avec un plafond de dépense. L'abonnement Claude ne la couvre pas.
3. **Couche interface : le cockpit**, petite application web sur le même VPS, construite à partir de la maquette.
   - Connexion par Supabase Auth pour Jay et Junior.
   - Messagerie : navigateur → serveur du cockpit → API Hermès.
   - Le rapport de 23 h arrive dans la table `messages`, donc dans la messagerie.

**Pourquoi pas tout dans claude.ai :**
- La base d'un artifact n'est lisible ni par n8n ni par Hermès.
- Une page artifact ne peut appeler aucun service extérieur.
- Les connecteurs d'une page ne marchent pas pour quelqu'un hors de l'organisation de Jay : Junior, avec son propre compte Claude, ne verrait pas les données en direct.
- Le connecteur Supabase de claude.ai agit avec des droits de développeur : il ne protège pas les lignes de Jay contre Junior. Junior y accède donc par le cockpit, et plus tard par un connecteur maison qui respecte ses droits.

**Écrans d'appel actuels** : on ne les touche pas pendant les journées d'appel. Chaque soir avant 23 h, on recopie leurs résultats dans Supabase, toujours dans le sens écran → Supabase. On migre quand le cockpit a sa propre page d'appel. Côté US, Junior construit ses écrans directement sur Supabase, pour éviter une deuxième migration.

**Claude Code** sert à construire (cockpit, workflows n8n, écrans). Hermès et n8n font tourner le quotidien.

## 4. Encaissement

- **Stripe pour encaisser, Revolut Business comme banque.**
- **France** : Stripe Billing, avec le prélèvement SEPA par défaut et la carte en secours.
  - 390 €/mois coûtent environ 3 € en SEPA, contre près de 14 € par carte pro (tarif « premium » 2,8 % + 0,25 €).
  - Engagement de 3 mois : échéancier d'abonnement, mise en place sur la 1ʳᵉ facture, résiliation coupée dans le portail client.
- **US** : Stripe en USD, avec le prélèvement ACH proposé en premier (0,8 % plafonné à 5 €, + 1,5 % de frais internationaux, + 2 % si Stripe convertit en euros), la carte US en secours (3,15 % + 0,25 €, + 2 % de conversion).
  - À tester sur un petit montant : garder les USD sur un compte USD (Revolut) pour éviter les 2 % de conversion.
- **Factures** : une seule suite de numéros, toutes émises par Stripe, avec deux modèles.
  - **France** : « TVA non applicable, art. 293 B du CGI », pénalités de retard, indemnité de 40 €, SIREN du client dès maintenant.
  - **US** : « TVA non applicable – art. 259-1 du CGI » (usage à confirmer par le comptable), avec une preuve que le client est une entreprise (EIN).
- **Facturation électronique** : la réception est obligatoire depuis le 1ᵉʳ septembre 2026, l'émission le sera le 1ᵉʳ septembre 2027. Ni Stripe ni Revolut ne sont plateforme agréée. **À choisir** : Billit (se branche sur Stripe), Qonto, Pennylane, Indy, Abby, Shine ou Tiime.
- **n8n** : le nœud Stripe Trigger, avec le secret de signature, reçoit `invoice.paid`, `invoice.payment_failed`, `customer.subscription.*`, `charge.refunded` et `charge.dispute.created`, puis remplit les pages cash.

## 5. Budget mensuel

Prix vérifiés au 3 octobre 2026. Les tokens d'Hermès et les minutes d'appel sont des estimations à mesurer la 1ʳᵉ semaine.

| Poste | V1 (0 à 6 clients) | À 12 nouveaux clients par mois |
|---|---|---|
| VPS OVH (n8n, Hermès, cockpit) | 8,65 € TTC (8 Go) | 12,48 € TTC (12 Go) |
| API Claude pour Hermès et les agents | 12 à 34 € | 34 à 88 € |
| Supabase Pro (sauvegardes quotidiennes, Paris) | environ 22 € | environ 22 € |
| Revolut Business Basic | 10 € | 10 € |
| Nom de domaine | 1,35 € | 1,35 € |
| n8n auto-hébergé | 0 € | 0 € |
| Vapi Core | 0 € (sans abonnement) | environ 26 € |
| Apify | 0 € (5 $ de crédit gratuit) | environ 17 € (Starter) |
| **Total fixe** | **environ 55 à 75 €** | **environ 125 à 180 €** |

- **Coûts variables par client et par mois** : 21 à 55 € en France (appels Vapi, numéro Twilio français, Stripe), 14 à 39 € aux US plus 4 à 6 % de Stripe.
- **TVA sur les achats** : compter environ 20 % de plus, autoliquidés. C'est vérifié pour les fournisseurs de l'UE ; pour ceux hors UE, c'est à confirmer par le comptable.
- **Options** :
  - signature électronique : DocuSeal auto-hébergé gratuit, ou Youtrust (ex-Yousign) dès 11 €/mois ;
  - Cal.com Teams : 12 $ par personne, quand il y aura un setter ou un closer.

## 6. Ce que les chiffres disent de l'objectif 6 + 6

La simulation est sur 12 mois, de novembre 2026 à octobre 2027. Hypothèses non mesurées : mix de paliers, départs de clients, moitié en packs payés d'avance, prix US de 497, 897 et 1 497 $, 1 $ = 0,891 €.
- **Récurrent** : environ 67 700 €/mois en octobre 2027. **Cash encaissé** : environ 536 000 € sur 12 mois, dont environ 367 000 € après cotisations (25,6 %) et coûts techniques. C'est avant salaires.
- **Seuils, si tout passe par la micro de Jay** :
  - TVA France (41 250 €) dépassée en mars 2027, avec TVA due dès ce jour sur les factures France ;
  - plafond micro (83 600 €) dépassé en mars 2027 aussi ;
  - la micro a été créée en août 2026 : les seuils 2026 sont réduits au prorata des jours d'activité. Selon le jour exact de création (du 1ᵉʳ au 31 août) :
    - TVA due dès **13 900 à 17 300 €** de CA France encaissé en 2026 ;
    - plafond micro 2026 : **28 200 à 35 000 €**, sur tout le CA encaissé (France et US).
    Avec 6 + 6 clients dès novembre, ces deux seuils peuvent sauter dès décembre 2026. Dépasser le plafond en 2026 puis en 2027 ferait passer au régime réel au 1ᵉʳ janvier 2028.
- **Heures** : avec les 10 à 13 h par client et par mois du calculateur, l'Essentiel à 390 € et le Starter à 497 $ perdent de l'argent dès qu'on paie l'heure de livraison (le plancher est à 672 € pour 11,5 h). À 6 h par client, le plancher tombe à 376 €.
- **Embauches** (aux heures actuelles) :
  - un setter par marché dès novembre 2026 ;
  - une personne en livraison dès décembre 2026 en France, dès novembre aux US ;
  - un closer vers février à avril 2027, ou plus tôt si moins d'1 démo sur 4 signe.
- **Partage** : décidé le 3 octobre. On paie d'abord toutes les cotisations et tous les coûts, puis on partage le résultat à 50/50. L'impôt sur le revenu de Jay porte aussi sur tout le CA (moins l'abattement forfaitaire de 34 % en BNC) : à provisionner avant le partage, ou à répartir d'un commun accord.

## 7. À faire, dans l'ordre

1. **Cette semaine** :
   - rendez-vous avec un expert-comptable : seuils 2026 au prorata (création en août), versement de la part de Junior au Cameroun depuis la micro, et le moment de passer en société (SAS) avant que le plafond ne bloque ;
   - choisir la plateforme agréée de facturation électronique ;
   - Junior fixe les prix US avec le skill `pricing-strategy`.
2. **Semaine 1** : projet Supabase + schéma + droits. Stripe (SEPA, ACH, deux modèles de facture). Flux Stripe → n8n → Supabase.
3. **Semaine 2** : VPS + Hermès (profil `centre`) + rapport de 23 h écrit dans `messages`.
4. **Semaines 3 et 4** : cockpit web à partir de la maquette, connexion Jay et Junior, pages cash branchées sur Supabase, messagerie Hermès.
5. **Ensuite** :
   - file « À valider » et niveaux d'autonomie, tout au niveau 1 pendant 30 jours ;
   - agents finance, paperasse, suivi clients ;
   - synchronisation puis migration des écrans d'appel.
6. **Pendant les pilotes** : mesurer les heures réelles par client et viser 6 h ou moins (modèles de visuels et de campagnes, rapports automatiques par n8n, points clients groupés).

## 8. Réponses du 3 octobre et questions encore ouvertes

**Réponses de Jay :**
- **Micro de Jay** :
  - créée en août 2026, activité « conseil, gestion, automatisation », sans ACRE ;
  - c'est très probablement du BNC (cotisations 25,6 %), à confirmer avec le code APE sur l'avis de situation SIRENE.
- **Junior** : résident fiscal au Cameroun, sans entreprise ni statut pour l'instant. Sa part est versée sur le résultat après cotisations et coûts.
- **Prix US** : plus élevés qu'en France. Junior les fixe avec le skill `pricing-strategy`. Si le premier client US arrive avant les premiers résultats en France, les preuves serviront à monter les prix.
- **Cockpit** : application web validée, avec un compte et un mot de passe par personne.

**Encore ouvert :**
- Jour exact de création de la micro (il fixe les seuils 2026 au prorata).
- CA déjà encaissé en 2026.
- Ce que Junior doit déclarer au Cameroun pour sa part (à voir de son côté).
- Faut-il afficher le cash US converti en euros au QG ? Par défaut : taux BCE du jour de chaque paiement.
- Junior doit-il voir les leads France ? C'est une décision RGPD et de gouvernance. Par défaut, il lit tout et n'écrit que ses lignes.

## 9. Fiscalité : micro ou société (calcul du 3 octobre 2026)

Hypothèses :
- 10 000 € encaissés par mois pendant 12 mois (120 000 €/an), avec 1 000 €/mois de coûts ;
- Jay seul, 1 part, sans autre revenu ; barème IR des revenus 2025 (celui de 2026 n'est pas encore voté) ;
- frais de société (comptable, CFE) : 2 500 €/an.

Le calcul a été refait de façon indépendante par un vérificateur.

| Pour un mois à 10 000 € | Jay | Junior | Total |
|---|---|---|---|
| Micro, IR payé par Jay seul | 1 805 € | 3 210 € | 5 015 € |
| Micro, IR retiré avant le partage | 2 507 € | 2 507 € | 5 015 € |
| **Micro + versement libératoire, partagé** | **3 100 €** | **3 100 €** | **6 200 €** |
| SAS sans salaire, dividendes (Jay au PFU 31,4 %) | 2 383 € | 3 029 € | 5 412 € |
| SAS sans salaire, Jay au barème | 2 762 € | 3 029 € | 5 791 € |
| SAS, salaire de Jay 2 000 € nets + dividendes | 3 388 € | 1 852 € | 5 240 € |

**Conclusion :** rester en micro en 2026 et 2027, puis passer en SAS au plus tard le 1ᵉʳ janvier 2028.
- **2026-2027** : la micro s'applique de plein droit l'année de création et la suivante, quel que soit le CA.
- **1ᵉʳ janvier 2028** : passage obligatoire si le plafond est dépassé en 2026 (au prorata) et en 2027.
- **Plus tôt, en 2027**, si le versement libératoire est impossible et que les 10 000 €/mois se confirment. Dans ce cas, la SAS laisse plus au total dès environ 62 000 €/an de CA.
- **Limites de la SAS** : les dividendes ne se versent qu'une fois par an, après l'approbation des comptes, et sans salaire Jay n'a ni retraite ni assurance maladie.

**Urgent :**
1. **Versement libératoire** : demande possible jusqu'au 30 novembre 2026 (année de création), si le RFR 2024 de Jay est au plus 29 579 € (1 part).
2. **TVA dès 2026** : les seuils 2026 sont au prorata de la création en août.
   - Au-delà d'environ 15 700 € de CA France encaissé en 2026, la TVA s'applique au 1ᵉʳ janvier 2027.
   - Au-delà d'environ 17 300 €, elle est due dès le jour du dépassement.
   - Ces chiffres valent pour une création le 1ᵉʳ août ; ils sont plus bas si la création est plus tardive.
   - À prévoir : numéro de TVA intracommunautaire, factures France à 20 %, contrats en « prix HT ».
3. **Contrat écrit entre Jay et Junior** (sous-traitance ou apport d'affaires), pour encadrer le partage et éviter une « société créée de fait ».

**À faire valider par un expert-comptable :**
- la retenue sur les sommes versées à Junior (art. 182 B, probablement écartée par la convention France–Cameroun) ;
- l'impôt de Junior au Cameroun ;
- le risque d'établissement stable au Cameroun.
