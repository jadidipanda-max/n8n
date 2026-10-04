-- 03 · File « À valider » : decider_action, changer_autonomie, trigger des actions, promotion_possible

-- ---------------------------------------------------------------------
-- decider_action : compteur ok_consecutifs
-- ---------------------------------------------------------------------
begin;
:en_jay
-- relancer_offre : niveau 1, 3 OK d'affilée dans les données d'exemple
select public.decider_action('a1000000-0000-4000-8000-000000000002', true);
:en_postgres
select tests.egal('validée sans correction : statut', (select statut from public.actions where id = 'a1000000-0000-4000-8000-000000000002'), 'validee');
select tests.egal('validée : decide_par = Jay', (select decide_par from public.actions where id = 'a1000000-0000-4000-8000-000000000002'),
                  '11111111-1111-4111-8111-111111111111'::uuid);
select tests.ok('validée : decide_le rempli', (select decide_le is not null from public.actions where id = 'a1000000-0000-4000-8000-000000000002'));
select tests.egal('validée : pas de correction', (select correction from public.actions where id = 'a1000000-0000-4000-8000-000000000002'), null::text);
select tests.egal('validée sans correction : ok_consecutifs 3 → 4',
  (select ok_consecutifs from public.autonomie where agent = 'paperasse' and type_action = 'relancer_offre'), 4);
select tests.egal('validée sans correction : niveau inchangé (1)',
  (select niveau from public.autonomie where agent = 'paperasse' and type_action = 'relancer_offre'), 1);
select tests.ok('une ligne de journal « Validée par Jay »',
  exists (select 1 from public.journal where agent = 'paperasse' and texte = 'Validée par Jay : Relance · Institut Néroli · offre sans réponse depuis 3 jours'));
select tests.ok('pas encore de promotion possible à 4 OK',
  not exists (select 1 from public.promotion_possible where agent = 'paperasse' and type_action = 'relancer_offre'));

-- 5e OK : la promotion devient possible
insert into public.actions (id, marche, agent, type_action, titre)
values ('a1000000-0000-4000-8000-000000000031', 'fr', 'paperasse', 'relancer_offre', 'Relance · Spa Lumen');
:en_jay
select public.decider_action('a1000000-0000-4000-8000-000000000031', true, '   ');
:en_postgres
select tests.egal('une correction vide ne compte pas : ok_consecutifs 5',
  (select ok_consecutifs from public.autonomie where agent = 'paperasse' and type_action = 'relancer_offre'), 5);
select tests.ok('promotion_possible propose relancer_offre à 5 OK',
  exists (select 1 from public.promotion_possible where agent = 'paperasse' and type_action = 'relancer_offre'));

-- correction : rétrogradation
insert into public.actions (id, marche, agent, type_action, titre)
values ('a1000000-0000-4000-8000-000000000032', 'fr', 'paperasse', 'relancer_offre', 'Relance · Cuisines Arlequin');
:en_jay
select public.decider_action('a1000000-0000-4000-8000-000000000032', true, 'Tutoie le gérant, il préfère.');
:en_postgres
select tests.egal('validée avec correction : statut validee',
  (select statut from public.actions where id = 'a1000000-0000-4000-8000-000000000032'), 'validee');
select tests.egal('validée avec correction : correction gardée',
  (select correction from public.actions where id = 'a1000000-0000-4000-8000-000000000032'), 'Tutoie le gérant, il préfère.');
select tests.egal('correction : ok_consecutifs remis à 0',
  (select ok_consecutifs from public.autonomie where agent = 'paperasse' and type_action = 'relancer_offre'), 0);
select tests.egal('correction : niveau 1 → 0',
  (select niveau from public.autonomie where agent = 'paperasse' and type_action = 'relancer_offre'), 0);
select tests.ok('correction : plus de promotion possible',
  not exists (select 1 from public.promotion_possible where agent = 'paperasse' and type_action = 'relancer_offre'));
select tests.ok('journal : « Validée avec correction par Jay »',
  exists (select 1 from public.journal where texte = 'Validée avec correction par Jay : Relance · Cuisines Arlequin'));

-- refus : rétrogradation, jamais sous 0
:en_jay
select public.decider_action('a1000000-0000-4000-8000-000000000003', false);
:en_postgres
select tests.egal('refusée : statut', (select statut from public.actions where id = 'a1000000-0000-4000-8000-000000000003'), 'refusee');
select tests.egal('refus : preparer_facture ok_consecutifs 4 → 0',
  (select ok_consecutifs from public.autonomie where agent = 'finance' and type_action = 'preparer_facture'), 0);
select tests.egal('refus : preparer_facture niveau 1 → 0',
  (select niveau from public.autonomie where agent = 'finance' and type_action = 'preparer_facture'), 0);
insert into public.actions (id, marche, agent, type_action, titre)
values ('a1000000-0000-4000-8000-000000000033', 'fr', 'finance', 'preparer_facture', 'Facture 2026-022');
:en_jay
select public.decider_action('a1000000-0000-4000-8000-000000000033', false, 'Mauvais montant');
:en_postgres
select tests.egal('refus au niveau 0 : le niveau reste à 0',
  (select niveau from public.autonomie where agent = 'finance' and type_action = 'preparer_facture'), 0);
select tests.ok('journal : « Refusée par Jay »',
  exists (select 1 from public.journal where texte = 'Refusée par Jay : Facture 2026-022'));

-- déjà décidée
:en_jay
select tests.echoue('refus si l''action est déjà validée',
  $$select public.decider_action('a1000000-0000-4000-8000-000000000002', true)$$, 'P0001');
select tests.echoue('refus si l''action est déjà refusée',
  $$select public.decider_action('a1000000-0000-4000-8000-000000000003', true)$$, 'P0001');
select tests.echoue('refus si l''action est déjà exécutée',
  $$select public.decider_action('a1000000-0000-4000-8000-000000000011', false)$$, 'P0001');
select tests.echoue('refus si l''action n''existe pas',
  $$select public.decider_action('a1000000-0000-4000-8000-0000000000ff', true)$$, 'P0002');
:en_postgres
select tests.egal('l''action déjà validée n''a pas changé',
  (select statut from public.actions where id = 'a1000000-0000-4000-8000-000000000002'), 'validee');

-- la ligne d'autonomie est créée si besoin (niveau 0)
insert into public.actions (id, marche, agent, type_action, titre)
values ('a1000000-0000-4000-8000-000000000034', 'us', 'suivi_clients', 'envoyer_avis_google', 'Demander un avis Google · Glow Aesthetics');
delete from public.autonomie where agent = 'suivi_clients' and type_action = 'envoyer_avis_google';
:en_junior
select public.decider_action('a1000000-0000-4000-8000-000000000034', true);
:en_postgres
select tests.egal('ligne d''autonomie créée par decider_action : niveau 0, 1 OK',
  (select niveau || '/' || ok_consecutifs || '/' || verrou from public.autonomie where agent = 'suivi_clients' and type_action = 'envoyer_avis_google'),
  '0/1/false');
select tests.egal('decide_par = Junior',
  (select decide_par from public.actions where id = 'a1000000-0000-4000-8000-000000000034'), '22222222-2222-4222-8222-222222222222'::uuid);
select tests.ok('journal : « Validée par Junior »',
  exists (select 1 from public.journal where marche = 'us' and texte = 'Validée par Junior : Demander un avis Google · Glow Aesthetics'));
rollback;

-- ---------------------------------------------------------------------
-- changer_autonomie
-- ---------------------------------------------------------------------
begin;
:en_jay
select tests.egal('Jay passe envoyer_proposition au niveau 1',
  (select niveau from public.changer_autonomie('paperasse', 'envoyer_proposition', 1)), 1);
:en_postgres
update public.autonomie set ok_consecutifs = 3 where agent = 'paperasse' and type_action = 'envoyer_proposition';
:en_jay
select tests.egal('changer_autonomie remet ok_consecutifs à 0',
  (select ok_consecutifs from public.changer_autonomie('paperasse', 'envoyer_proposition', 2)), 0);
select tests.egal('… et le niveau est 2',
  (select niveau from public.autonomie where agent = 'paperasse' and type_action = 'envoyer_proposition'), 2);
select tests.ok('journal : changement d''autonomie noté',
  exists (select 1 from public.journal where agent = 'paperasse' and texte like 'Autonomie « envoyer_proposition » : autonome, décidé par Jay'));
select tests.echoue('refus d''un niveau > 0 sur une action verrouillée (changer_prix)',
  $$select public.changer_autonomie('finance', 'changer_prix', 1)$$, 'P0001');
select tests.echoue('refus du niveau 2 sur une action verrouillée (relance_impaye)',
  $$select public.changer_autonomie('finance', 'relance_impaye', 2)$$, 'P0001');
select tests.egal('niveau 0 accepté sur une action verrouillée',
  (select niveau from public.changer_autonomie('finance', 'changer_prix', 0)), 0);
select tests.echoue('refus d''un niveau hors 0..2',
  $$select public.changer_autonomie('paperasse', 'relancer_offre', 3)$$, '22023');
select tests.echoue('refus d''un niveau négatif',
  $$select public.changer_autonomie('paperasse', 'relancer_offre', -1)$$, '22023');
select tests.egal('nouvelle paire créée par changer_autonomie',
  (select niveau from public.changer_autonomie('researcher', 'resumer_veille', 1)), 1);
select tests.echoue('nouveau type verrouillé par nature : refus du niveau 1',
  $$select public.changer_autonomie('hermes', 'envoyer_argent', 1)$$, 'P0001');
:en_junior
select tests.echoue('Junior ne change pas l''autonomie (même pour son marché)',
  $$select public.changer_autonomie('prospection_us', 'preparer_messages_facebook', 0)$$, '42501');
:en_postgres
select tests.egal('l''autonomie de Junior n''a pas bougé',
  (select niveau from public.autonomie where agent = 'prospection_us' and type_action = 'preparer_messages_facebook'), 2);
rollback;

-- ---------------------------------------------------------------------
-- Trigger des actions (n8n et Hermès créent les actions avec la clé secrète)
-- ---------------------------------------------------------------------
begin;
:en_service
insert into public.actions (id, marche, agent, type_action, titre, statut, auto) values
  ('a1000000-0000-4000-8000-000000000041', 'fr', 'finance', 'relance_impaye', 'Relance impayé · Cuisines Delmas', 'executee', true),
  ('a1000000-0000-4000-8000-000000000042', 'fr', 'prospection_fr', 'preparer_messages_facebook', 'Messages Facebook · 12 gérants', 'executee', true),
  ('a1000000-0000-4000-8000-000000000043', 'fr', 'paperasse', 'relancer_offre', 'Relance · Spa Lumen', 'executee', true),
  ('a1000000-0000-4000-8000-000000000044', 'us', 'paperasse', 'envoyer_proposition', 'Proposition · Lone Star', 'validee', false),
  ('a1000000-0000-4000-8000-000000000045', 'us', 'hermes', 'payer_facture_apify', 'Payer Apify 2 $', 'en_attente', false);
insert into public.actions (id, marche, agent, type_action, titre, details) values
  ('a1000000-0000-4000-8000-000000000046', null, 'researcher', 'chercher_pistes', 'Comparer les statuts', '{"verrou": true}');
:en_postgres
select tests.egal('auto refusé sur une action verrouillée → en attente',
  (select statut || '/' || auto from public.actions where id = 'a1000000-0000-4000-8000-000000000041'), 'en_attente/false');
select tests.egal('auto accepté au niveau 2',
  (select statut || '/' || auto from public.actions where id = 'a1000000-0000-4000-8000-000000000042'), 'executee/true');
select tests.egal('auto refusé au niveau 1 avant 5 OK',
  (select statut || '/' || auto from public.actions where id = 'a1000000-0000-4000-8000-000000000043'), 'en_attente/false');
select tests.egal('une action créée « validee » arrive quand même en attente',
  (select statut from public.actions where id = 'a1000000-0000-4000-8000-000000000044'), 'en_attente');
select tests.egal('nouveau type : ligne d''autonomie créée au niveau 0',
  (select niveau || '/' || ok_consecutifs || '/' || verrou from public.autonomie where agent = 'hermes' and type_action = 'payer_facture_apify'),
  '0/0/false');
select tests.egal('details.verrou = true verrouille le type (et le remet au niveau 0)',
  (select niveau || '/' || verrou from public.autonomie where agent = 'researcher' and type_action = 'chercher_pistes'), '0/true');
select tests.ok('journal : « À valider » pour une action en attente',
  exists (select 1 from public.journal where texte = 'À valider : Relance impayé · Cuisines Delmas'));
select tests.ok('journal : « Fait seul » pour une action autonome',
  exists (select 1 from public.journal where texte = 'Fait seul (autonomie) : Messages Facebook · 12 gérants'));
-- niveau 1 après 5 OK : autonome
update public.autonomie set ok_consecutifs = 5 where agent = 'paperasse' and type_action = 'relancer_offre';
:en_service
insert into public.actions (id, marche, agent, type_action, titre, statut, auto)
values ('a1000000-0000-4000-8000-000000000047', 'fr', 'paperasse', 'relancer_offre', 'Relance · Institut Néroli (2)', 'executee', true);
:en_postgres
select tests.egal('auto accepté au niveau 1 après 5 OK',
  (select statut || '/' || auto from public.actions where id = 'a1000000-0000-4000-8000-000000000047'), 'executee/true');
:en_service
insert into public.actions (id, marche, agent, type_action, titre, auto)
values ('a1000000-0000-4000-8000-000000000048', 'us', 'prospection_us', 'preparer_messages_facebook', 'Messages Facebook · 8 med spas', true);
:en_postgres
select tests.egal('action autonome créée sans statut : validee (jamais dans la file « À valider »)',
  (select statut || '/' || auto from public.actions where id = 'a1000000-0000-4000-8000-000000000048'), 'validee/true');
rollback;
:en_postgres
