-- 02 · Droits (RLS) : anon, personne sans profil, Junior (associé US), Jay (admin), clé secrète
:en_postgres

-- Un compte connecté qui n'a pas de profil
insert into auth.users (id, email, aud, role)
values ('33333333-3333-4333-8333-333333333333', 'inconnu@exemple.com', 'authenticated', 'authenticated');

-- Une action sans marché (seul l'admin peut la décider)
insert into public.actions (id, marche, agent, type_action, titre)
values ('a1000000-0000-4000-8000-000000000020', null, 'researcher', 'changer_offre', 'Tester un tarif annuel avec 2 mois offerts');

-- Une paire d'autonomie mûre pour une promotion (pour que promotion_possible ait des lignes)
insert into public.autonomie (agent, type_action, niveau, ok_consecutifs)
values ('suivi_clients', 'test_promotion', 1, 5);

-- Ce que voit postgres (référence)
create table tests.ref_comptes as select nom, tests.compte(nom) as n from tests.relations;
grant select on tests.ref_comptes to public;
select tests.ok('référence : chaque table et vue a des lignes', (select bool_and(n > 0) from tests.ref_comptes));

-- ---------------------------------------------------------------------
-- anon : ne voit rien, ne fait rien
-- ---------------------------------------------------------------------
:en_anon
select tests.ne_voit_rien('anon', nom) from tests.relations order by nom;
select tests.echoue('anon : decider_action refusé',
  $$select public.decider_action('a1000000-0000-4000-8000-000000000001', true)$$, '42501');
select tests.echoue('anon : changer_autonomie refusé',
  $$select public.changer_autonomie('finance', 'preparer_facture', 2)$$, '42501');
select tests.echoue('anon : cash_resume_au refusé',
  $$select * from public.cash_resume_au(now())$$, '42501');
select tests.echoue('anon : pas de message',
  $$insert into public.messages (auteur, contenu) values ('jay', 'coucou')$$, '42501');

-- ---------------------------------------------------------------------
-- Connecté sans profil : ne voit rien
-- ---------------------------------------------------------------------
:en_inconnu
select tests.egal('sans profil : 0 ligne dans ' || nom, tests.compte(nom), 0::bigint) from tests.relations order by nom;
select tests.egal('sans profil : est_membre() faux', public.est_membre(), false);
select tests.egal('sans profil : mon_marche() vide', public.mon_marche(), null::text);
select tests.echoue('sans profil : decider_action refusé',
  $$select public.decider_action('a1000000-0000-4000-8000-000000000005', true)$$, '42501');
select tests.echoue('sans profil : changer_autonomie refusé',
  $$select public.changer_autonomie('finance', 'preparer_facture', 2)$$, '42501');
select tests.echoue('sans profil : pas de message signé junior',
  $$insert into public.messages (auteur, auteur_id, contenu)
    values ('junior', '33333333-3333-4333-8333-333333333333', 'salut')$$, '42501');
select tests.echoue('sans profil : pas de client',
  $$insert into public.clients (marche, nom, devise) values ('fr', 'Client pirate', 'EUR')$$);

-- ---------------------------------------------------------------------
-- Junior (associé, marché US)
-- ---------------------------------------------------------------------
:en_junior
select tests.egal('Junior lit tout : ' || r.nom, tests.compte(r.nom), r.n) from tests.ref_comptes r order by r.nom;
select tests.egal('Junior : est_admin() faux', public.est_admin(), false);
select tests.egal('Junior : mon_marche() = us', public.mon_marche(), 'us');

-- clients de Jay : intouchables
select tests.egal('Junior ne modifie pas un client de Jay (0 ligne)',
  tests.nb($$update public.clients set nom = 'Piraté' where nom = 'Institut Aurore'$$), 0::bigint);
select tests.egal('Junior ne supprime pas un client de Jay (0 ligne)',
  tests.nb($$delete from public.clients where nom = 'Cuisines Delmas'$$), 0::bigint);
select tests.echoue('Junior ne crée pas un client au nom de Jay',
  $$insert into public.clients (marche, nom, devise, owner_id)
    values ('fr', 'Faux client', 'EUR', '11111111-1111-4111-8111-111111111111')$$, '42501');
select tests.echoue('Junior ne donne pas son client à Jay',
  $$update public.clients set owner_id = '11111111-1111-4111-8111-111111111111' where nom = 'Glow Aesthetics'$$, '42501');

-- ses propres lignes : oui
begin;
select tests.egal('Junior modifie son propre client',
  tests.nb($$update public.clients set resultat_valeur = 4 where nom = 'Glow Aesthetics'$$), 1::bigint);
select tests.egal('Junior crée un client (owner_id = lui par défaut)',
  tests.nb($$insert into public.clients (marche, nom, devise) values ('us', 'Radiance MedSpa', 'USD')$$), 1::bigint);
select tests.egal('… et ce client lui appartient',
  (select owner_id from public.clients where nom = 'Radiance MedSpa'), '22222222-2222-4222-8222-222222222222'::uuid);
select tests.egal('Junior met à jour un appel à lui',
  tests.nb($$update public.appels set statut = 'demo' where lead_ref = 'fl-001'$$), 1::bigint);
select tests.egal('Junior ne touche pas un appel de Jay (0 ligne)',
  tests.nb($$update public.appels set statut = 'demo' where lead_ref = 'std-001'$$), 0::bigint);
rollback;
:en_junior

-- tables réservées à n8n et aux fonctions
select tests.echoue('Junior n''insère pas de paiement',
  $$insert into public.paiements (stripe_event_id, marche, type, montant, devise, paye_le)
    values ('evt_pirate', 'us', 'ponctuel', 1000, 'USD', now())$$, '42501');
select tests.echoue('Junior ne modifie pas un paiement',
  $$update public.paiements set montant = 1 where stripe_event_id = 'evt_demo_0001'$$, '42501');
select tests.echoue('Junior n''insère pas d''abonnement',
  $$insert into public.abonnements (stripe_subscription_id, statut, montant, devise) values ('sub_pirate', 'active', 1, 'USD')$$, '42501');
select tests.echoue('Junior ne valide pas une action en direct (UPDATE)',
  $$update public.actions set statut = 'validee' where marche = 'us'$$, '42501');
select tests.echoue('Junior n''insère pas d''action',
  $$insert into public.actions (agent, type_action, titre) values ('hermes', 'test', 'test')$$, '42501');
select tests.echoue('Junior ne change pas l''autonomie en direct',
  $$update public.autonomie set niveau = 2 where agent = 'paperasse' and type_action = 'envoyer_proposition'$$, '42501');
select tests.echoue('Junior n''écrit pas dans le journal',
  $$insert into public.journal (agent, texte) values ('junior', 'test')$$, '42501');
select tests.echoue('Junior n''écrit pas de rapport',
  $$insert into public.rapports (jour, verdict, resume, contenu) values ('2026-10-03', 'tenir', 'x', 'x')$$, '42501');
select tests.echoue('Junior ne modifie pas agents_etat',
  $$update public.agents_etat set statut = 'err'$$, '42501');
select tests.echoue('Junior ne modifie pas son profil (rôle)',
  $$update public.profils set role = 'admin' where nom = 'Junior'$$, '42501');
select tests.egal('Junior ne modifie pas les réglages (0 ligne)',
  tests.nb($$update public.reglages set valeur = '{"jay": 0, "junior": 1}' where cle = 'partage'$$), 0::bigint);
select tests.egal('… et le partage reste 50/50',
  (select valeur ->> 'junior' from public.reglages where cle = 'partage'), '0.5');
select tests.echoue('Junior n''ajoute pas de réglage',
  $$insert into public.reglages (cle, valeur) values ('pirate', '{}')$$, '42501');
select tests.egal('Junior ne modifie pas un objectif (0 ligne)',
  tests.nb($$update public.objectifs set cash_vise = 1 where marche = 'us'$$), 0::bigint);
select tests.echoue('Junior n''insère pas d''objectif',
  $$insert into public.objectifs (mois, marche, clients_vises, cash_vise, devise) values ('2026-11-01', 'us', 10, 9000, 'USD')$$, '42501');
select tests.echoue('Junior n''insère pas de coût',
  $$insert into public.couts (mois, poste, montant_eur) values ('2026-10-01', 'Test', 1)$$, '42501');

-- messages
select tests.echoue('Junior n''écrit pas un message signé jay',
  $$insert into public.messages (auteur, auteur_id, contenu) values ('jay', '22222222-2222-4222-8222-222222222222', 'faux Jay')$$, '42501');
select tests.echoue('Junior n''écrit pas un message signé hermes',
  $$insert into public.messages (auteur, auteur_id, contenu) values ('hermes', '22222222-2222-4222-8222-222222222222', 'faux Hermès')$$, '42501');
select tests.echoue('Junior n''écrit pas au nom de Jay (auteur_id)',
  $$insert into public.messages (auteur, auteur_id, contenu) values ('junior', '11111111-1111-4111-8111-111111111111', 'x')$$, '42501');
select tests.echoue('Junior ne modifie pas un message',
  $$update public.messages set contenu = 'modifié'$$, '42501');
select tests.echoue('Junior ne supprime pas un message',
  $$delete from public.messages$$, '42501');
begin;
select tests.egal('Junior écrit un message signé junior',
  tests.nb($$insert into public.messages (auteur, auteur_id, marche, contenu)
             values ('junior', '22222222-2222-4222-8222-222222222222', 'us', 'Salut Hermès')$$), 1::bigint);
select tests.egal('Junior écrit un message sans auteur_id (rempli par défaut)',
  tests.nb($$insert into public.messages (auteur, contenu) values ('junior', 'Deuxième message')$$), 1::bigint);
rollback;
:en_junior

-- décisions
select tests.echoue('Junior ne valide pas une action FR',
  $$select public.decider_action('a1000000-0000-4000-8000-000000000001', true)$$, '42501');
select tests.echoue('Junior ne refuse pas une action FR',
  $$select public.decider_action('a1000000-0000-4000-8000-000000000003', false)$$, '42501');
select tests.echoue('Junior ne valide pas une action sans marché',
  $$select public.decider_action('a1000000-0000-4000-8000-000000000020', true)$$, '42501');
begin;
select tests.egal('Junior valide une action US',
  (select statut from public.decider_action('a1000000-0000-4000-8000-000000000005', true)), 'validee');
rollback;
:en_junior
select tests.echoue('Junior ne change pas un niveau d''autonomie',
  $$select public.changer_autonomie('paperasse', 'envoyer_proposition', 1)$$, '42501');
select tests.egal('l''action FR est toujours en attente',
  (select statut from public.actions where id = 'a1000000-0000-4000-8000-000000000001'), 'en_attente');

-- messages forgés en passant à côté du serveur (PostgREST direct)
select tests.echoue('Junior n''écrit pas un message de type rapport',
  $$insert into public.messages (auteur, auteur_id, type, contenu) values ('junior', '22222222-2222-4222-8222-222222222222', 'rapport', 'faux rapport')$$, '42501');
select tests.echoue('Junior n''écrit pas une alerte',
  $$insert into public.messages (auteur, type, contenu) values ('junior', 'alerte', 'fausse alerte')$$, '42501');
select tests.echoue('Junior ne met pas de meta dans son message',
  $$insert into public.messages (auteur, contenu, meta) values ('junior', 'x', '{"rapport": "2026-10-03"}')$$, '42501');
begin;
insert into public.messages (auteur, contenu, cree_le) values ('junior', 'Je reste en tête', '2099-01-01');
select tests.ok('date du message posée par la base (pas en 2099)',
  (select cree_le < now() + interval '1 minute' from public.messages where contenu = 'Je reste en tête'));
select tests.ok('… et le message n''est pas « plus récent » que les suivants',
  (select cree_le <= now() from public.messages where contenu = 'Je reste en tête'));
rollback;
:en_junior
select tests.echoue('Junior n''inonde pas la messagerie (5000 messages d''un coup)',
  $$insert into public.messages (auteur, contenu) select 'junior', 'spam ' || i from generate_series(1, 5000) as i$$, 'P0001');
begin;
select tests.egal('30 messages dans la minute passent',
  tests.nb($$insert into public.messages (auteur, contenu) select 'junior', 'm ' || i from generate_series(1, 30) as i$$), 30::bigint);
select tests.echoue('… le 31e est refusé',
  $$insert into public.messages (auteur, contenu) values ('junior', 'un de trop')$$, 'P0001');
rollback;
:en_junior

-- clients et appels : seulement sur son marché ; Stripe relié par l'admin seulement
select tests.echoue('Junior ne crée pas de client France',
  $$insert into public.clients (marche, nom, devise) values ('fr', 'Client fantôme', 'EUR')$$, '42501');
select tests.echoue('Junior ne réclame pas un client Stripe (stripe_customer_id)',
  $$insert into public.clients (marche, nom, devise, stripe_customer_id) values ('us', 'Client Stripe', 'USD', 'cus_futur_client')$$, '42501');
select tests.echoue('Junior ne change pas le stripe_customer_id de son client',
  $$update public.clients set stripe_customer_id = 'cus_autre' where nom = 'Glow Aesthetics'$$, '42501');
select tests.echoue('Junior ne passe pas son client sur le marché France',
  $$update public.clients set marche = 'fr', devise = 'EUR' where nom = 'Glow Aesthetics'$$, '42501');
select tests.echoue('Junior ne crée pas d''appel France',
  $$insert into public.appels (marche, ecran, lead_ref) values ('fr', 'standard', 'pirate-001')$$, '42501');
begin;
select tests.egal('Junior crée un appel USA',
  tests.nb($$insert into public.appels (marche, ecran, lead_ref, statut) values ('us', 'us_floride', 'fl-900', 'a_appeler')$$), 1::bigint);
rollback;
:en_junior

-- ---------------------------------------------------------------------
-- Jay (admin)
-- ---------------------------------------------------------------------
:en_jay
select tests.egal('Jay lit tout : ' || r.nom, tests.compte(r.nom), r.n) from tests.ref_comptes r order by r.nom;
select tests.egal('Jay : est_admin() vrai', public.est_admin(), true);
select tests.egal('Jay : mon_marche() = fr', public.mon_marche(), 'fr');

begin;
select tests.egal('Jay valide une action FR',
  (select statut from public.decider_action('a1000000-0000-4000-8000-000000000001', true)), 'validee');
select tests.egal('Jay valide une action US',
  (select statut from public.decider_action('a1000000-0000-4000-8000-000000000005', true)), 'validee');
select tests.egal('Jay valide une action sans marché',
  (select statut from public.decider_action('a1000000-0000-4000-8000-000000000020', true)), 'validee');
select tests.egal('Jay refuse une action US',
  (select statut from public.decider_action('a1000000-0000-4000-8000-000000000004', false)), 'refusee');
select tests.egal('Jay modifie un client de Junior',
  tests.nb($$update public.clients set resultat_valeur = 5 where nom = 'Glow Aesthetics'$$), 1::bigint);
select tests.egal('Jay modifie un réglage',
  tests.nb($$update public.reglages set valeur = '{"usd_eur": 0.9, "source": "test"}' where cle = 'change'$$), 1::bigint);
select tests.egal('Jay ajoute un objectif',
  tests.nb($$insert into public.objectifs (mois, marche, clients_vises, cash_vise, devise) values ('2026-11-01', 'fr', 6, 8000, 'EUR')$$), 1::bigint);
select tests.egal('Jay ajoute un coût',
  tests.nb($$insert into public.couts (mois, poste, montant_eur) values ('2026-10-01', 'Vapi', 12)$$), 1::bigint);
select tests.egal('Jay écrit un message signé jay',
  tests.nb($$insert into public.messages (auteur, auteur_id, contenu) values ('jay', '11111111-1111-4111-8111-111111111111', 'Go')$$), 1::bigint);
rollback;
:en_jay
begin;
select tests.egal('Jay relie une fiche client à Stripe',
  tests.nb($$update public.clients set stripe_customer_id = 'cus_demo_glow_2' where nom = 'Glow Aesthetics'$$), 1::bigint);
select tests.egal('Jay crée un client USA',
  tests.nb($$insert into public.clients (marche, nom, devise, stripe_customer_id) values ('us', 'Lone Star Spa', 'USD', 'cus_lone_star')$$), 1::bigint);
select tests.echoue('appels : marché inconnu refusé (même pour Jay)',
  $$insert into public.appels (marche, ecran, lead_ref) values ('de', 'standard', 'de-001')$$, '23514');
rollback;
:en_jay
select tests.echoue('Jay n''écrit pas un message signé junior',
  $$insert into public.messages (auteur, auteur_id, contenu) values ('junior', '11111111-1111-4111-8111-111111111111', 'x')$$, '42501');
select tests.echoue('Jay n''écrit pas un message signé hermes',
  $$insert into public.messages (auteur, auteur_id, contenu) values ('hermes', '11111111-1111-4111-8111-111111111111', 'x')$$, '42501');
select tests.echoue('Jay n''insère pas de paiement (seul n8n le fait)',
  $$insert into public.paiements (stripe_event_id, marche, type, montant, devise, paye_le)
    values ('evt_jay', 'fr', 'ponctuel', 10, 'EUR', now())$$, '42501');
select tests.echoue('Jay ne modifie pas une action en direct',
  $$update public.actions set statut = 'validee' where id = 'a1000000-0000-4000-8000-000000000001'$$, '42501');
select tests.echoue('Jay ne supprime pas un réglage',
  $$delete from public.reglages where cle = 'partage'$$, '42501');

-- ---------------------------------------------------------------------
-- Clé secrète (n8n, serveur) : écrit là où les personnes ne peuvent pas
-- ---------------------------------------------------------------------
:en_service
begin;
select tests.passe('service_role insère un paiement',
  $$insert into public.paiements (stripe_event_id, marche, type, montant, devise, taux_eur, paye_le)
    values ('evt_n8n_test', 'us', 'abonnement', 497, 'USD', 0.891, now())$$);
select tests.passe('service_role écrit un message d''Hermès',
  $$insert into public.messages (auteur, type, contenu) values ('hermes', 'rapport', 'Rapport du soir')$$);
select tests.passe('service_role crée une action',
  $$insert into public.actions (marche, agent, type_action, titre) values ('fr', 'finance', 'relance_impaye', 'Relance impayé')$$);
select tests.passe('service_role met à jour agents_etat',
  $$update public.agents_etat set statut = 'ok' where agent = 'reporter'$$);
select tests.ok('service_role lit les vues de cash', tests.compte('v_cash_resume') = 3);
rollback;
:en_postgres

-- ---------------------------------------------------------------------
-- Fiches clients et paiements Stripe : reliés dans les deux sens
-- ---------------------------------------------------------------------
begin;
:en_service
-- 1er paiement d'un client qui n'a pas encore de fiche
insert into public.paiements (stripe_event_id, stripe_customer_id, marche, type, montant, devise, paye_le)
values ('evt_nouveau_client', 'cus_nouveau', 'fr', 'abonnement', 390, 'EUR', now());
insert into public.abonnements (stripe_subscription_id, stripe_customer_id, marche, statut, montant, devise)
values ('sub_nouveau', 'cus_nouveau', 'fr', 'active', 390, 'EUR');
:en_postgres
select tests.egal('paiement sans fiche : client_id vide',
  (select client_id from public.paiements where stripe_event_id = 'evt_nouveau_client'), null::uuid);
:en_jay
insert into public.clients (marche, nom, devise, stripe_customer_id, debut)
values ('fr', 'Spa Lumen', 'EUR', 'cus_nouveau', current_date);
:en_postgres
select tests.ok('fiche ajoutée après coup : le paiement est rattaché',
  (select p.client_id = c.id from public.paiements p, public.clients c
    where p.stripe_event_id = 'evt_nouveau_client' and c.stripe_customer_id = 'cus_nouveau'));
select tests.ok('… et l''abonnement aussi',
  (select a.client_id = c.id from public.abonnements a, public.clients c
    where a.stripe_subscription_id = 'sub_nouveau' and c.stripe_customer_id = 'cus_nouveau'));
-- fiche créée par n8n (clé secrète, sans propriétaire) : elle va à l'associé du marché
:en_service
insert into public.clients (marche, nom, devise, stripe_customer_id) values ('us', 'Radiance MedSpa', 'USD', 'cus_radiance')
on conflict (stripe_customer_id) do nothing;
insert into public.clients (marche, nom, devise, stripe_customer_id) values ('us', 'Nom écrasé ?', 'USD', 'cus_radiance')
on conflict (stripe_customer_id) do nothing;
:en_postgres
select tests.egal('fiche créée par n8n sur les USA : propriétaire = Junior',
  (select owner_id from public.clients where stripe_customer_id = 'cus_radiance'), '22222222-2222-4222-8222-222222222222'::uuid);
select tests.egal('… et n8n n''écrase pas une fiche existante',
  (select nom from public.clients where stripe_customer_id = 'cus_radiance'), 'Radiance MedSpa');
:en_junior
select tests.egal('Junior complète la fiche créée par n8n',
  tests.nb($$update public.clients set niche = 'Med spa · Orlando, FL' where stripe_customer_id = 'cus_radiance'$$), 1::bigint);
rollback;
:en_postgres
