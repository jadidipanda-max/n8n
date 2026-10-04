-- 01 · Structure : RLS partout, vues en security_invoker, réglages, droits, temps réel
:en_postgres

select tests.egal('RLS activée sur les 14 tables du schéma public',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity), 14::bigint);
select tests.egal('aucune table du schéma public sans RLS',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0::bigint);

select tests.ok('vue ' || v || ' en security_invoker',
  (select coalesce('security_invoker=true' = any (c.reloptions), false)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v))
  from unnest(array['promotion_possible', 'v_cash_mensuel', 'v_cash_resume', 'v_cash_attendu',
                    'v_cash_cumul', 'v_seuils', 'v_partage']) as v;

select tests.ok('fonction ' || f || ' : security definer + search_path = public',
  (select p.prosecdef and 'search_path=public' = any (p.proconfig)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f))
  from unnest(array['est_membre', 'est_admin', 'mon_marche', 'decider_action', 'changer_autonomie']) as f;

select tests.ok('est_membre, est_admin et mon_marche sont stable',
  (select bool_and(p.provolatile = 's') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('est_membre', 'est_admin', 'mon_marche')));

select tests.egal('anon n''a aucun droit sur les tables et vues',
  (select count(*) from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'), 0::bigint);
select tests.egal('anon n''exécute aucune fonction du schéma public',
  (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')), null::text);
select tests.ok('anon ne peut pas exécuter decider_action',
  not has_function_privilege('anon', 'public.decider_action(uuid, boolean, text)', 'execute'));
select tests.ok('authenticated peut exécuter decider_action',
  has_function_privilege('authenticated', 'public.decider_action(uuid, boolean, text)', 'execute'));
select tests.ok('authenticated ne peut pas insérer dans paiements (droit retiré)',
  not has_table_privilege('authenticated', 'public.paiements', 'insert'));
select tests.ok('service_role peut insérer dans paiements',
  has_table_privilege('service_role', 'public.paiements', 'insert'));

-- Réglages insérés par la migration
select tests.egal('5 réglages', (select count(*) from public.reglages), 5::bigint);
select tests.egal('seuils.date_creation', (select valeur ->> 'date_creation' from public.reglages where cle = 'seuils'), '2026-07-19');
select tests.egal('seuils.tva_base', (select (valeur ->> 'tva_base')::numeric from public.reglages where cle = 'seuils'), 37500::numeric);
select tests.egal('seuils.tva_majore', (select (valeur ->> 'tva_majore')::numeric from public.reglages where cle = 'seuils'), 41250::numeric);
select tests.egal('seuils.plafond_micro', (select (valeur ->> 'plafond_micro')::numeric from public.reglages where cle = 'seuils'), 83600::numeric);
select tests.egal('cotisations.taux', (select (valeur ->> 'taux')::numeric from public.reglages where cle = 'cotisations'), 0.256);
select tests.egal('change.usd_eur', (select (valeur ->> 'usd_eur')::numeric from public.reglages where cle = 'change'), 0.891);
select tests.egal('objectif_mensuel', (select valeur from public.reglages where cle = 'objectif_mensuel'), '{"fr": 6, "us": 6}'::jsonb);
select tests.egal('partage', (select valeur from public.reglages where cle = 'partage'),
                  '{"jay": 0.5, "junior": 0.5, "base": "apres_cotisations_et_couts"}'::jsonb);

-- Index du contrat
select tests.ok('index ' || i, exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i))
  from unnest(array['paiements_paye_le_idx', 'paiements_marche_paye_le_idx', 'journal_cree_le_idx',
                    'messages_cree_le_idx', 'actions_statut_cree_le_idx']) as i;

-- Temps réel
select tests.ok('table ' || t || ' publiée pour Supabase Realtime',
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t))
  from unnest(array['paiements', 'actions', 'messages', 'journal', 'agents_etat']) as t;

-- Colonne générée montant_eur et contraintes
begin;
insert into public.paiements (stripe_event_id, marche, type, montant, devise, taux_eur, paye_le)
values ('evt_test_genere', 'us', 'ponctuel', 100.05, 'USD', 0.891, '2026-10-02 12:00+02');
select tests.egal('montant_eur = round(montant × taux_eur, 2)',
  (select montant_eur from public.paiements where stripe_event_id = 'evt_test_genere'), 89.14::numeric);
select tests.echoue('stripe_event_id unique (doublon refusé)',
  $$insert into public.paiements (stripe_event_id, marche, type, montant, devise, paye_le)
    values ('evt_test_genere', 'us', 'ponctuel', 1, 'USD', now())$$, '23505');
select tests.echoue('type de paiement inconnu refusé',
  $$insert into public.paiements (stripe_event_id, marche, type, montant, devise, paye_le)
    values ('evt_test_type', 'fr', 'cadeau', 1, 'EUR', now())$$, '23514');
select tests.echoue('message de plus de 8000 caractères refusé',
  $$insert into public.messages (auteur, contenu) values ('hermes', repeat('a', 8001))$$, '23514');
select tests.echoue('autonomie : verrou avec niveau > 0 impossible',
  $$update public.autonomie set niveau = 2 where agent = 'finance' and type_action = 'changer_prix'$$, '23514');
-- Le paiement Stripe est relié tout seul à sa fiche client
insert into public.paiements (stripe_event_id, stripe_customer_id, marche, type, montant, devise, paye_le)
values ('evt_test_relie', 'cus_demo_glow', 'us', 'ponctuel', 10, 'USD', now());
select tests.egal('paiement relié au client par stripe_customer_id',
  (select client_id from public.paiements where stripe_event_id = 'evt_test_relie'), 'c1000000-0000-4000-8000-000000000006'::uuid);
rollback;

-- maj mise à jour automatiquement
begin;
update public.agents_etat set maj = '2000-01-01' where agent = 'finance';
update public.agents_etat set statut = 'ok' where agent = 'finance';
select tests.ok('agents_etat.maj mise à jour à la modification',
  (select maj > '2026-01-01' from public.agents_etat where agent = 'finance'));
rollback;

-- Données d'exemple chargées
select tests.egal('seed : 2 profils', (select count(*) from public.profils), 2::bigint);
select tests.egal('seed : 6 clients', (select count(*) from public.clients), 6::bigint);
select tests.egal('seed : 11 paiements dont 1 remboursement', (select count(*) || '/' || count(*) filter (where type = 'remboursement') from public.paiements), '11/1');
select tests.egal('seed : 5 actions en attente', (select count(*) from public.actions where statut = 'en_attente'), 5::bigint);
select tests.egal('seed : un seul rapport', (select count(*) from public.rapports), 1::bigint);
select tests.ok('seed : au moins un verrou dans autonomie', exists (select 1 from public.autonomie where verrou));
select tests.egal('seed rejouée sans doublon dans le journal',
  (select count(*) from (select texte, cree_le from public.journal group by 1, 2 having count(*) > 1) d), 0::bigint);
