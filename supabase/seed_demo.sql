-- =====================================================================
-- Données d'exemple du cockpit J-Square (état au 3 octobre 2026).
-- JAMAIS EN PRODUCTION : comptes, clients et paiements fictifs.
-- Cohérentes avec la maquette cockpit/tour-de-controle.html.
-- À lancer après la migration, avec la clé secrète ou en postgres.
-- Rejouable : rien n'est dupliqué si on la relance.
-- =====================================================================

-- Comptes fictifs (sur Supabase, ce sont normalement Jay et Junior qui les créent)
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'jay@exemple.fr',     'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'junior@exemple.com', 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.profils (id, nom, role, marche) values
  ('11111111-1111-4111-8111-111111111111', 'Jay',    'admin',   'fr'),
  ('22222222-2222-4222-8222-222222222222', 'Junior', 'associe', 'us')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Clients : 5 en France (Jay), 1 aux États-Unis (Junior)
-- ---------------------------------------------------------------------
insert into public.clients (id, marche, nom, niche, palier, prix_mensuel, devise, mise_en_place, debut, fin_engagement,
                            objectif_garantie, objectif_valeur, resultat_valeur, prochain_point, point_booke,
                            stripe_customer_id, statut, owner_id) values
  ('c1000000-0000-4000-8000-000000000001', 'fr', 'Institut Aurore', 'Esthétique', 'Pilote', 190, 'EUR', 0,
   '2026-09-08', '2026-12-08', 'demandes qualifiées', 30, 21, '2026-10-08 10:00+02', true,
   'cus_demo_aurore', 'actif', '11111111-1111-4111-8111-111111111111'),
  ('c1000000-0000-4000-8000-000000000002', 'fr', 'Cuisines Delmas', 'Cuisiniste', 'Pilote', 190, 'EUR', 0,
   '2026-09-15', '2026-12-15', 'RDV en showroom', 12, 4, '2026-10-15 14:00+02', true,
   'cus_demo_delmas', 'actif', '11111111-1111-4111-8111-111111111111'),
  ('c1000000-0000-4000-8000-000000000003', 'fr', 'Rivage Immobilier', 'Immobilier', 'Pilote', 190, 'EUR', 0,
   '2026-09-24', '2026-12-24', 'RDV d''estimation', 10, 2, '2026-10-23 11:00+02', true,
   'cus_demo_rivage', 'actif', '11111111-1111-4111-8111-111111111111'),
  ('c1000000-0000-4000-8000-000000000004', 'fr', 'Maison Solène', 'Esthétique', 'Essentiel', 390, 'EUR', 290,
   '2026-10-01', '2027-01-01', 'demandes qualifiées', 25, 0, '2026-11-02 10:00+01', true,
   'cus_demo_solene', 'actif', '11111111-1111-4111-8111-111111111111'),
  ('c1000000-0000-4000-8000-000000000005', 'fr', 'Atelier Bois & Plan', 'Cuisiniste', 'Croissance', 690, 'EUR', 590,
   '2026-10-02', '2027-04-02', 'RDV en showroom', 15, 0, '2026-11-03 15:00+01', true,
   'cus_demo_atelier', 'actif', '11111111-1111-4111-8111-111111111111'),
  ('c1000000-0000-4000-8000-000000000006', 'us', 'Glow Aesthetics', 'Med spa · Tampa, FL', 'Starter', 497, 'USD', 500,
   '2026-10-01', '2027-01-01', 'consultations réservées', 24, 3, '2026-11-02 11:00-05', true,
   'cus_demo_glow', 'actif', '22222222-2222-4222-8222-222222222222')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Abonnements Stripe (2 packs trimestriels : Aurore et Maison Solène)
-- ---------------------------------------------------------------------
insert into public.abonnements (stripe_subscription_id, stripe_customer_id, client_id, marche, statut, montant, devise,
                                intervalle_mois, debut, fin_engagement, prochaine_facture) values
  ('sub_demo_aurore',  'cus_demo_aurore',  'c1000000-0000-4000-8000-000000000001', 'fr', 'active',  570, 'EUR', 3,
   '2026-09-08 10:00+02', '2026-12-08 10:00+01', '2026-12-08 10:00+01'),
  ('sub_demo_delmas',  'cus_demo_delmas',  'c1000000-0000-4000-8000-000000000002', 'fr', 'active',  190, 'EUR', 1,
   '2026-09-15 10:00+02', '2026-12-15 10:00+01', '2026-10-15 10:00+02'),
  ('sub_demo_rivage',  'cus_demo_rivage',  'c1000000-0000-4000-8000-000000000003', 'fr', 'active',  190, 'EUR', 1,
   '2026-09-24 10:00+02', '2026-12-24 10:00+01', '2026-10-24 10:00+02'),
  ('sub_demo_solene',  'cus_demo_solene',  'c1000000-0000-4000-8000-000000000004', 'fr', 'active', 1170, 'EUR', 3,
   '2026-10-01 09:00+02', '2027-01-01 09:00+01', '2027-01-01 09:00+01'),
  ('sub_demo_atelier', 'cus_demo_atelier', 'c1000000-0000-4000-8000-000000000005', 'fr', 'active',  690, 'EUR', 1,
   '2026-10-02 09:00+02', '2027-04-02 09:00+02', '2026-11-02 09:00+01'),
  ('sub_demo_glow',    'cus_demo_glow',    'c1000000-0000-4000-8000-000000000006', 'us', 'active',  497, 'USD', 1,
   '2026-10-01 10:00-04', '2027-01-01 10:00-05', '2026-11-01 10:00-05')
on conflict (stripe_subscription_id) do nothing;

-- ---------------------------------------------------------------------
-- Paiements (dont un prélèvement en double, remboursé)
-- France : 3 690 € depuis le 8 sept., dont 2 740 € en octobre. USA : 997 $ en octobre.
-- ---------------------------------------------------------------------
insert into public.paiements (stripe_event_id, stripe_invoice_id, stripe_customer_id, marche, type, montant, devise,
                              taux_eur, paye_le, description) values
  ('evt_demo_0001',    'in_demo_0001', 'cus_demo_aurore',  'fr', 'pack',           570, 'EUR', 1,     '2026-09-08 10:12+02', 'Pilote · 3 mois payés d''avance'),
  ('evt_demo_0002',    'in_demo_0002', 'cus_demo_delmas',  'fr', 'abonnement',     190, 'EUR', 1,     '2026-09-15 09:40+02', 'Pilote · 1er mois'),
  ('evt_demo_0003',    'in_demo_0002', 'cus_demo_delmas',  'fr', 'ponctuel',       190, 'EUR', 1,     '2026-09-16 06:05+02', 'Prélèvement SEPA reçu en double'),
  ('evt_demo_0004',    'in_demo_0002', 'cus_demo_delmas',  'fr', 'remboursement', -190, 'EUR', 1,     '2026-09-17 11:20+02', 'Remboursement du prélèvement en double'),
  ('evt_demo_0005',    'in_demo_0005', 'cus_demo_rivage',  'fr', 'abonnement',     190, 'EUR', 1,     '2026-09-24 10:30+02', 'Pilote · 1er mois'),
  ('evt_demo_0006:l1', 'in_demo_0006', 'cus_demo_solene',  'fr', 'pack',          1170, 'EUR', 1,     '2026-10-01 09:05+02', 'Essentiel · 3 mois payés d''avance'),
  ('evt_demo_0006:l2', 'in_demo_0006', 'cus_demo_solene',  'fr', 'mise_en_place',  290, 'EUR', 1,     '2026-10-01 09:05+02', 'Mise en place'),
  ('evt_demo_0007:l1', 'in_demo_0007', 'cus_demo_atelier', 'fr', 'abonnement',     690, 'EUR', 1,     '2026-10-02 09:12+02', 'Croissance · 1er mois'),
  ('evt_demo_0007:l2', 'in_demo_0007', 'cus_demo_atelier', 'fr', 'mise_en_place',  590, 'EUR', 1,     '2026-10-02 09:12+02', 'Mise en place'),
  ('evt_demo_0008:l1', 'in_demo_0008', 'cus_demo_glow',    'us', 'abonnement',     497, 'USD', 0.891, '2026-10-01 10:00-04', 'Starter · 1st month'),
  ('evt_demo_0008:l2', 'in_demo_0008', 'cus_demo_glow',    'us', 'mise_en_place',  500, 'USD', 0.891, '2026-10-01 10:00-04', 'Setup')
on conflict (stripe_event_id) do nothing;

-- ---------------------------------------------------------------------
-- Objectifs d'octobre (calculés par l'agent finance) et coûts
-- ---------------------------------------------------------------------
insert into public.objectifs (mois, marche, clients_vises, cash_vise, devise, calcule_par) values
  ('2026-10-01', 'fr', 6, 7680, 'EUR', 'finance'),
  ('2026-10-01', 'us', 6, 5960, 'USD', 'finance')
on conflict (mois, marche) do nothing;

insert into public.couts (mois, poste, montant_eur) values
  ('2026-09-01', 'Serveur OVH (n8n, Hermès, cockpit)', 8.65),
  ('2026-09-01', 'Nom de domaine',                     1.35),
  ('2026-10-01', 'Serveur OVH (n8n, Hermès, cockpit)', 8.65),
  ('2026-10-01', 'Crédits API d''Hermès',             23.00),
  ('2026-10-01', 'Supabase Pro',                      22.00),
  ('2026-10-01', 'Revolut Business',                  10.00),
  ('2026-10-01', 'Nom de domaine',                     1.35)
on conflict (mois, poste) do nothing;

-- ---------------------------------------------------------------------
-- Écrans d'appel (extrait)
-- ---------------------------------------------------------------------
insert into public.appels (marche, ecran, lead_ref, statut, note, rappel_le, maj, owner_id)
select 'fr', 'standard', 'std-' || lpad(i::text, 3, '0'),
       (array['a_appeler', 'joint', 'rappel', 'pas_interesse', 'demo'])[1 + i % 5],
       case when i % 5 = 2 then 'Rappel demandé' end,
       case when i % 5 = 2 then '2026-10-06 10:00+02'::timestamptz end,
       '2026-10-03 11:00+02'::timestamptz - make_interval(mins => i * 7),
       '11111111-1111-4111-8111-111111111111'::uuid
  from generate_series(1, 12) as i
on conflict (ecran, lead_ref) do nothing;

insert into public.appels (marche, ecran, lead_ref, statut, maj, owner_id)
select 'fr', 'acquisition', 'acq-' || lpad(i::text, 3, '0'), 'a_appeler', '2026-10-01 09:00+02',
       '11111111-1111-4111-8111-111111111111'::uuid
  from generate_series(1, 4) as i
on conflict (ecran, lead_ref) do nothing;

insert into public.appels (marche, ecran, lead_ref, statut, maj, owner_id)
select 'us', 'us_floride', 'fl-' || lpad(i::text, 3, '0'),
       (array['a_appeler', 'joint', 'pas_interesse', 'demo'])[1 + i % 4],
       '2026-10-03 13:30+02'::timestamptz - make_interval(mins => i * 5),
       '22222222-2222-4222-8222-222222222222'::uuid
  from generate_series(1, 10) as i
on conflict (ecran, lead_ref) do nothing;

-- ---------------------------------------------------------------------
-- Autonomie (avant les actions : le trigger des actions la consulte)
-- ---------------------------------------------------------------------
insert into public.autonomie (agent, type_action, niveau, verrou, ok_consecutifs, maj) values
  ('prospection_fr', 'preparer_messages_facebook', 2, false, 0, '2026-09-20 10:00+02'),
  ('prospection_us', 'preparer_messages_facebook', 2, false, 0, '2026-09-30 10:00+02'),
  ('prospection_fr', 'mission_apify',              0, true,  0, '2026-09-01 10:00+02'),
  ('prospection_us', 'mission_apify',              0, true,  0, '2026-09-01 10:00+02'),
  ('paperasse',      'preparer_proposition',       2, false, 0, '2026-09-10 10:00+02'),
  ('paperasse',      'envoyer_proposition',        0, false, 0, '2026-09-10 10:00+02'),
  ('paperasse',      'relancer_offre',             1, false, 3, '2026-10-02 23:14+02'),
  ('paperasse',      'envoyer_contrat',            0, true,  0, '2026-09-01 10:00+02'),
  ('finance',        'preparer_facture',           1, false, 4, '2026-10-01 08:40+02'),
  ('finance',        'changer_prix',               0, true,  0, '2026-09-01 10:00+02'),
  ('finance',        'alerte_prix_plancher',       2, false, 0, '2026-09-01 10:00+02'),
  ('finance',        'relance_impaye',             0, true,  0, '2026-09-01 10:00+02'),
  ('suivi_clients',  'booker_point_mensuel',       2, false, 0, '2026-09-08 10:00+02'),
  ('suivi_clients',  'envoyer_rapport_mensuel',    1, false, 1, '2026-09-30 10:00+02'),
  ('suivi_clients',  'booker_demo',                2, false, 0, '2026-09-08 10:00+02'),
  ('suivi_clients',  'deplacer_rdv_client',        0, false, 0, '2026-09-08 10:00+02'),
  ('researcher',     'chercher_pistes',            2, false, 0, '2026-09-01 10:00+02'),
  ('researcher',     'changer_offre',              0, false, 0, '2026-09-01 10:00+02'),
  ('reporter',       'ecrire_rapport',             2, false, 0, '2026-09-01 10:00+02'),
  ('reporter',       'changer_trajectoire',        0, false, 0, '2026-09-01 10:00+02'),
  ('reporter',       'sources_externes',           2, false, 0, '2026-09-01 10:00+02')
on conflict (agent, type_action) do nothing;

-- ---------------------------------------------------------------------
-- Actions : 5 en attente (3 pour Jay, 2 pour Junior) et un peu d'historique.
-- Le trigger écrit la ligne de journal ; on ne réinsère jamais une action existante.
-- ---------------------------------------------------------------------
insert into public.actions (id, marche, agent, type_action, titre, details, auto, cree_le)
select v.id::uuid, v.marche, v.agent, v.type_action, v.titre, v.details::jsonb, v.auto, v.cree_le::timestamptz
  from (values
    ('a1000000-0000-4000-8000-000000000001', 'fr', 'paperasse', 'envoyer_proposition',
     'Proposition · Spa Lumen · Essentiel 390 €/mois', '{"prospect": "Spa Lumen", "palier": "Essentiel", "prix": 390}', false, '2026-10-03 13:48+02'),
    ('a1000000-0000-4000-8000-000000000002', 'fr', 'paperasse', 'relancer_offre',
     'Relance · Institut Néroli · offre sans réponse depuis 3 jours', '{"prospect": "Institut Néroli", "prevue_le": "2026-10-03T09:30:00+02:00"}', false, '2026-10-02 23:14+02'),
    ('a1000000-0000-4000-8000-000000000003', 'fr', 'finance', 'preparer_facture',
     'Facture 2026-021 · Atelier Bois & Plan · 690 €', '{"numero": "2026-021", "montant": 690}', false, '2026-10-02 09:20+02'),
    ('a1000000-0000-4000-8000-000000000004', 'us', 'prospection_us', 'mission_apify',
     'Mission Apify · Houston, TX · 500 med spas · environ 2 $', '{"ville": "Houston, TX", "volume": 500, "cout_estime_usd": 2}', false, '2026-10-03 08:30-04'),
    ('a1000000-0000-4000-8000-000000000005', 'us', 'paperasse', 'envoyer_proposition',
     'Proposition · Radiance MedSpa (Orlando) · Starter 497 $/mois', '{"prospect": "Radiance MedSpa", "palier": "Starter", "prix": 497}', false, '2026-10-03 07:50-04'),
    -- historique
    ('a1000000-0000-4000-8000-000000000011', 'fr', 'finance', 'preparer_facture',
     'Facture 2026-020 · Maison Solène · 1 460 €', '{"numero": "2026-020", "montant": 1460}', false, '2026-10-01 08:30+02'),
    ('a1000000-0000-4000-8000-000000000012', 'fr', 'paperasse', 'relancer_offre',
     'Relance · Cuisines Arlequin · offre du 25 sept.', '{"prospect": "Cuisines Arlequin"}', false, '2026-09-29 18:00+02'),
    ('a1000000-0000-4000-8000-000000000013', 'us', 'paperasse', 'envoyer_contrat',
     'Contrat · Glow Aesthetics · Starter 497 $/mois', '{"client": "Glow Aesthetics"}', false, '2026-09-30 09:00-04'),
    ('a1000000-0000-4000-8000-000000000014', 'fr', 'prospection_fr', 'preparer_messages_facebook',
     'Messages Facebook du jour · 14 gérants', '{"nombre": 14}', true, '2026-10-03 08:00+02'),
    ('a1000000-0000-4000-8000-000000000015', 'us', 'prospection_us', 'preparer_messages_facebook',
     'Messages Facebook du jour · 9 med spas', '{"nombre": 9}', true, '2026-10-03 08:00-04')
  ) as v (id, marche, agent, type_action, titre, details, auto, cree_le)
 where not exists (select 1 from public.actions a where a.id = v.id::uuid);

-- Décisions passées (directement, sans toucher aux compteurs d'autonomie déjà posés)
update public.actions set statut = 'executee', decide_par = '11111111-1111-4111-8111-111111111111', decide_le = '2026-10-01 08:40+02'
 where id = 'a1000000-0000-4000-8000-000000000011' and statut = 'en_attente';
update public.actions set statut = 'executee', decide_par = '11111111-1111-4111-8111-111111111111', decide_le = '2026-09-29 21:10+02'
 where id = 'a1000000-0000-4000-8000-000000000012' and statut = 'en_attente';
update public.actions set statut = 'executee', decide_par = '22222222-2222-4222-8222-222222222222', decide_le = '2026-09-30 11:00-04'
 where id = 'a1000000-0000-4000-8000-000000000013' and statut = 'en_attente';
update public.actions set statut = 'executee'
 where id in ('a1000000-0000-4000-8000-000000000014', 'a1000000-0000-4000-8000-000000000015') and auto;

-- ---------------------------------------------------------------------
-- Messagerie Hermès et rapport du soir
-- ---------------------------------------------------------------------
insert into public.messages (id, auteur, auteur_id, marche, type, contenu, meta, cree_le) values
  ('b1000000-0000-4000-8000-000000000001', 'hermes', null, 'fr', 'message',
   'Paiement reçu : Atelier Bois & Plan, 1 280 €. Ajouté au cash du mois.', '{"paiement": "evt_demo_0007"}', '2026-10-02 09:12+02'),
  ('b1000000-0000-4000-8000-000000000002', 'hermes', null, null, 'rapport',
   E'Rapport du 2 octobre\n- France : 83 appels, 47 gérants joints, 2 démos prises.\n- USA : 41 appels, 1 démo prise.\n- Cash du mois : 3 628 € (France 2 740 € · USA 997 $).\n- Verdict : tenir le cap. 12 démos sur les 20 nécessaires pour juger le prix.\n3 décisions t''attendent.',
   '{"rapport": "2026-10-02"}', '2026-10-02 23:00+02'),
  ('b1000000-0000-4000-8000-000000000003', 'jay', '11111111-1111-4111-8111-111111111111', 'fr', 'message',
   'Ok. Relance Néroli demain matin.', '{}', '2026-10-02 23:14:10+02'),
  ('b1000000-0000-4000-8000-000000000004', 'hermes', null, 'fr', 'message',
   'Noté, relance prévue demain à 9:30. C''est ta 3ᵉ validation sans correction sur ce type de relance : à 5, je les enverrai seul.',
   '{}', '2026-10-02 23:14:40+02'),
  ('b1000000-0000-4000-8000-000000000005', 'hermes', null, 'us', 'message',
   'Point du jour : 2 décisions t''attendent (mission Apify à Houston, proposition Radiance MedSpa).', '{}', '2026-10-03 08:05-04'),
  ('b1000000-0000-4000-8000-000000000006', 'junior', '22222222-2222-4222-8222-222222222222', 'us', 'message',
   'Démo Radiance confirmée mardi 15:00, heure de Floride.', '{}', '2026-10-03 08:20-04')
on conflict (id) do nothing;

insert into public.rapports (jour, verdict, resume, contenu, donnees, cree_le) values
  ('2026-10-02', 'tenir', 'Tenir le cap : 12 démos sur les 20 nécessaires pour juger le prix.',
   E'France : 83 appels, 47 gérants joints, 2 démos prises.\nUSA : 41 appels, 1 démo prise.\nCash du mois : 3 628 € (France 2 740 € · USA 997 $).\nVerdict : tenir le cap. 12 démos sur les 20 nécessaires pour juger le prix.',
   '{"appels_fr": 83, "joints_fr": 47, "demos_fr": 2, "appels_us": 41, "demos_us": 1, "demos_total": 12, "demos_necessaires": 20}',
   '2026-10-02 23:00+02')
on conflict (jour) do nothing;

-- ---------------------------------------------------------------------
-- État des agents (7 agents et Hermès)
-- ---------------------------------------------------------------------
insert into public.agents_etat (agent, nom, marche, statut, derniere_phrase, derniere_execution, prochaine_execution, cout_jour_eur) values
  ('hermes',         'Hermès',                   null, 'ok',   'Rapport du 2 octobre envoyé à Jay et Junior.',          '2026-10-02 23:02+02', null,                  0.94),
  ('prospection_fr', 'Prospection France',       'fr', 'run',  'Prépare les messages Facebook du jour',                 '2026-10-03 13:54+02', null,                  0.21),
  ('prospection_us', 'Prospection USA',          'us', 'run',  'Prépare les messages Facebook du jour',                 '2026-10-03 13:51+02', null,                  0.18),
  ('finance',        'Finance',                  null, 'run',  'Recalcule les objectifs du mois',                       '2026-10-03 14:02+02', null,                  0.34),
  ('paperasse',      'Propositions et contrats', null, 'wait', '2 brouillons à relire',                                 '2026-10-03 13:48+02', null,                  0.52),
  ('reporter',       'Rapport du soir',          null, 'idle', 'Prochain rapport à 23:00',                              '2026-10-02 23:00+02', '2026-10-03 23:00+02', 0),
  ('researcher',     'Recherche rentabilité',    null, 'run',  'Compare les statuts juridiques',                        '2026-10-03 13:50+02', null,                  0.61),
  ('suivi_clients',  'Suivi clients',            null, 'ok',   'Points mensuels bookés',                                '2026-10-03 13:21+02', null,                  0.12)
on conflict (agent) do nothing;

-- ---------------------------------------------------------------------
-- Journal (en plus des lignes écrites par le trigger des actions)
-- ---------------------------------------------------------------------
insert into public.journal (id, marche, agent, texte, cree_le) values
  ('d1000000-0000-4000-8000-000000000001', null, 'hermes',         'Paiement reçu : Atelier Bois & Plan, 1 280 €.',       '2026-10-02 09:12+02'),
  ('d1000000-0000-4000-8000-000000000002', null, 'hermes',         'Rapport du 2 octobre envoyé à Jay et Junior.',        '2026-10-02 23:02+02'),
  ('d1000000-0000-4000-8000-000000000003', 'us', 'prospection_us', 'Floride : 188 med spas appelés sur 1 000.',           '2026-10-03 13:30+02'),
  ('d1000000-0000-4000-8000-000000000004', 'fr', 'paperasse',      'Brouillon Spa Lumen prêt à relire.',                  '2026-10-03 13:48+02'),
  ('d1000000-0000-4000-8000-000000000005', 'fr', 'finance',        'Objectif d''octobre recalculé : 6 clients, 7 680 €.', '2026-10-03 14:02+02')
on conflict (id) do nothing;
