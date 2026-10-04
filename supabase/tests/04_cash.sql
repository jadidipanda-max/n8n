-- 04 · Vues de cash, valeurs calculées à la main sur les données d'exemple.
-- Date de référence : 3 octobre 2026, 12:00 à Paris.
--
-- France (EUR) : sept. 570 + 190 + 190 − 190 (remboursement) + 190 = 950 ; oct. 1170 + 290 + 690 + 590 = 2 740.
-- USA (USD)    : oct. 497 + 500 = 997 $ ; en euros 442,83 + 445,50 = 888,33 € (taux 0,891 de chaque paiement).
-- MRR France   : 570/3 + 190 + 190 + 1170/3 + 690 = 190 + 190 + 190 + 390 + 690 = 1 650 €.
-- MRR USA      : 497 $ = 442,83 € (taux des réglages 0,891).
:en_jay

-- ---------------------------------------------------------------------
-- v_cash_resume (via cash_resume_au)
-- ---------------------------------------------------------------------
select tests.egal('résumé fr : ' || k, v, a) from (
  select r.* from public.cash_resume_au(:ref) r where r.marche = 'fr'
) r, lateral (values
  ('devise',              r.devise::text,                'EUR'),
  ('cash_mois',           r.cash_mois::text,             '2740.00'),
  ('cash_mois_eur',       r.cash_mois_eur::text,         '2740.00'),
  ('cumul',               r.cumul::text,                 '3690.00'),
  ('cumul_eur',           r.cumul_eur::text,             '3690.00'),
  ('premier_paiement',    r.premier_paiement::text,      '2026-09-08'),
  ('mrr (packs ÷ 3)',     r.mrr::text,                   '1650.00'),
  ('mrr_eur',             r.mrr_eur::text,               '1650.00'),
  ('objectif_cash',       r.objectif_cash::text,         '7680.00'),
  ('objectif_clients',    r.objectif_clients::text,      '6'),
  ('clients_signes_mois', r.clients_signes_mois::text,   '2')
) as t (k, v, a);

select tests.egal('résumé us : ' || k, v, a) from (
  select r.* from public.cash_resume_au(:ref) r where r.marche = 'us'
) r, lateral (values
  ('devise',              r.devise::text,                'USD'),
  ('cash_mois',           r.cash_mois::text,             '997.00'),
  ('cash_mois_eur',       r.cash_mois_eur::text,         '888.33'),
  ('cumul',               r.cumul::text,                 '997.00'),
  ('cumul_eur',           r.cumul_eur::text,             '888.33'),
  ('premier_paiement',    r.premier_paiement::text,      '2026-10-01'),
  ('mrr',                 r.mrr::text,                   '497.00'),
  ('mrr_eur',             r.mrr_eur::text,               '442.83'),
  ('objectif_cash',       r.objectif_cash::text,         '5960.00'),
  ('objectif_clients',    r.objectif_clients::text,      '6'),
  ('clients_signes_mois', r.clients_signes_mois::text,   '1')
) as t (k, v, a);

-- total en euros : paiements au taux de chaque paiement, MRR et objectif au taux des réglages
select tests.egal('résumé total : ' || k, v, a) from (
  select r.* from public.cash_resume_au(:ref) r where r.marche = 'total'
) r, lateral (values
  ('devise',              r.devise::text,                'EUR'),
  ('cash_mois',           r.cash_mois::text,             '3628.33'),
  ('cash_mois_eur',       r.cash_mois_eur::text,         '3628.33'),
  ('cumul',               r.cumul::text,                 '4578.33'),
  ('cumul_eur',           r.cumul_eur::text,             '4578.33'),
  ('premier_paiement',    r.premier_paiement::text,      '2026-09-08'),
  ('mrr',                 r.mrr::text,                   '2092.83'),
  ('mrr_eur',             r.mrr_eur::text,               '2092.83'),
  ('objectif_cash',       r.objectif_cash::text,         '12990.36'),
  ('objectif_clients',    r.objectif_clients::text,      '12'),
  ('clients_signes_mois', r.clients_signes_mois::text,   '3')
) as t (k, v, a);

-- au 20 septembre : pas encore d'octobre, pas d'objectif saisi (le nombre de clients vient des réglages)
select tests.egal('20 sept. fr : cash_mois / cumul / signés / objectif_cash / objectif_clients',
  (select concat_ws('|', cash_mois, cumul, clients_signes_mois, coalesce(objectif_cash::text, 'null'), objectif_clients)
     from public.cash_resume_au('2026-09-20 12:00+02') where marche = 'fr'),
  '950.00|950.00|3|null|6');
select tests.egal('20 sept. us : rien encaissé, premier_paiement vide',
  (select concat_ws('|', cash_mois, cumul, coalesce(premier_paiement::text, 'null'), clients_signes_mois)
     from public.cash_resume_au('2026-09-20 12:00+02') where marche = 'us'),
  '0|0|null|0');

-- la vue appelle bien la fonction avec now()
select tests.egal('v_cash_resume = cash_resume_au(now())',
  (select count(*) from (select * from public.v_cash_resume except select * from public.cash_resume_au(now())) d), 0::bigint);
select tests.egal('v_cash_resume : lignes fr, us, total',
  (select string_agg(marche, ',' order by marche) from public.v_cash_resume), 'fr,total,us');

-- MRR : seuls les abonnements active, trialing, past_due comptent
begin;
:en_postgres
update public.abonnements set statut = 'canceled', annule_le = '2026-10-02' where stripe_subscription_id = 'sub_demo_solene';
update public.abonnements set statut = 'past_due' where stripe_subscription_id = 'sub_demo_delmas';
update public.abonnements set statut = 'incomplete' where stripe_subscription_id = 'sub_demo_rivage';
:en_jay
select tests.egal('MRR fr sans le pack annulé ni l''abonnement incomplet : 1650 − 390 − 190',
  (select mrr from public.cash_resume_au(:ref) where marche = 'fr'), 1070.00);
rollback;

-- Le total : USD des paiements au taux du paiement, USD du MRR et de l'objectif au taux des réglages
begin;
:en_jay
update public.reglages set valeur = '{"usd_eur": 0.9, "source": "test"}' where cle = 'change';
select tests.egal('taux des réglages à 0,9 : cash du mois total inchangé (taux du paiement)',
  (select cash_mois from public.cash_resume_au(:ref) where marche = 'total'), 3628.33);
select tests.egal('taux des réglages à 0,9 : MRR us en euros = 447,30',
  (select mrr_eur from public.cash_resume_au(:ref) where marche = 'us'), 447.30);
select tests.egal('taux des réglages à 0,9 : MRR total = 2097,30',
  (select mrr from public.cash_resume_au(:ref) where marche = 'total'), 2097.30);
select tests.egal('taux des réglages à 0,9 : objectif total = 7680 + 5364',
  (select objectif_cash from public.cash_resume_au(:ref) where marche = 'total'), 13044.00);
rollback;

-- Mois à l'heure de Paris : 30 sept. 22:30 UTC = 1er oct. 00:30 à Paris
begin;
:en_postgres
insert into public.paiements (stripe_event_id, marche, type, montant, devise, paye_le) values
  ('evt_test_minuit_1', 'fr', 'ponctuel', 100, 'EUR', '2026-09-30 22:30:00+00'),
  ('evt_test_minuit_2', 'fr', 'ponctuel', 1000, 'EUR', '2026-10-31 23:30:00+00');
:en_jay
select tests.egal('paiement du 1er oct. 00:30 (Paris) compté en octobre',
  (select cash_mois from public.cash_resume_au(:ref) where marche = 'fr'), 2840.00);
select tests.egal('paiement du 1er nov. 00:30 (Paris) compté en novembre dans v_cash_mensuel',
  (select montant from public.v_cash_mensuel where marche = 'fr' and mois = '2026-11-01'), 1000.00);
rollback;

-- ---------------------------------------------------------------------
-- v_cash_attendu (via cash_attendu_au) : novembre, décembre, janvier
-- Engagé si la facture tombe avant fin_engagement, sinon probable.
--   fr nov. : Delmas 15/11 + Rivage 24/11 + Atelier 2/11      = 1070 engagé
--   fr déc. : Atelier 690 engagé ; Aurore 8/12 (= fin), Delmas 15/12 (= fin), Rivage 24/12 (= fin) = 570 + 190 + 190 probable
--   fr janv.: Atelier 690 engagé ; Delmas, Rivage, Maison Solène 1/1 (= fin) = 190 + 190 + 1170 probable
--   us : 497 engagé en nov. et déc., 497 probable en janv. (1/1 = fin)
-- ---------------------------------------------------------------------
select tests.egal('attendu ' || a.marche || ' ' || to_char(a.mois, 'YYYY-MM'),
  concat_ws('|', a.devise, a.engage, a.probable, a.engage_eur, a.probable_eur), t.attendu)
  from public.cash_attendu_au(:ref) a
  join (values
    ('fr',    '2026-11-01'::date, 'EUR|1070.00|0.00|1070.00|0.00'),
    ('fr',    '2026-12-01'::date, 'EUR|690.00|950.00|690.00|950.00'),
    ('fr',    '2027-01-01'::date, 'EUR|690.00|1550.00|690.00|1550.00'),
    ('us',    '2026-11-01'::date, 'USD|497.00|0.00|442.83|0.00'),
    ('us',    '2026-12-01'::date, 'USD|497.00|0.00|442.83|0.00'),
    ('us',    '2027-01-01'::date, 'USD|0.00|497.00|0.00|442.83'),
    ('total', '2026-11-01'::date, 'EUR|1512.83|0.00|1512.83|0.00'),
    ('total', '2026-12-01'::date, 'EUR|1132.83|950.00|1132.83|950.00'),
    ('total', '2027-01-01'::date, 'EUR|690.00|1992.83|690.00|1992.83')
  ) as t (marche, mois, attendu) on t.marche = a.marche and t.mois = a.mois;
select tests.egal('attendu : 9 lignes (3 marchés × 3 mois)', (select count(*) from public.cash_attendu_au(:ref)), 9::bigint);
select tests.egal('v_cash_attendu : 9 lignes', (select count(*) from public.v_cash_attendu), 9::bigint);

-- Autour de fin_engagement (facture Delmas du 15 déc. à 10:00, heure de Paris)
begin;
:en_postgres
update public.abonnements set fin_engagement = '2026-12-15 10:00:01+01' where stripe_subscription_id = 'sub_demo_delmas';
:en_jay
select tests.egal('fin_engagement 1 s après la facture : Delmas déc. passe en engagé',
  (select engage || '|' || probable from public.cash_attendu_au(:ref) where marche = 'fr' and mois = '2026-12-01'), '880.00|760.00');
:en_postgres
update public.abonnements set fin_engagement = '2026-12-15 09:59:59+01' where stripe_subscription_id = 'sub_demo_delmas';
:en_jay
select tests.egal('fin_engagement 1 s avant la facture : Delmas déc. reste probable',
  (select engage || '|' || probable from public.cash_attendu_au(:ref) where marche = 'fr' and mois = '2026-12-01'), '690.00|950.00');
:en_postgres
update public.abonnements set fin_engagement = null where stripe_subscription_id = 'sub_demo_delmas';
:en_jay
select tests.egal('sans fin_engagement : toujours engagé (janv.)',
  (select engage || '|' || probable from public.cash_attendu_au(:ref) where marche = 'fr' and mois = '2027-01-01'), '880.00|1360.00');
:en_postgres
update public.abonnements set annule_le = '2026-12-01 00:00+01' where stripe_subscription_id = 'sub_demo_rivage';
update public.abonnements set statut = 'canceled' where stripe_subscription_id = 'sub_demo_aurore';
:en_jay
select tests.egal('abonnement annulé au 1er déc. et abonnement canceled : plus attendus en déc.',
  (select engage || '|' || probable from public.cash_attendu_au(:ref) where marche = 'fr' and mois = '2026-12-01'), '880.00|0.00');
rollback;

-- ---------------------------------------------------------------------
-- v_cash_cumul : un point par jour avec paiement
-- ---------------------------------------------------------------------
:en_jay
select tests.egal('cumul fr',
  (select string_agg(jour || '=' || cumul, ' ' order by jour) from public.v_cash_cumul where marche = 'fr'),
  '2026-09-08=570.00 2026-09-15=760.00 2026-09-16=950.00 2026-09-17=760.00 2026-09-24=950.00 2026-10-01=2410.00 2026-10-02=3690.00');
select tests.egal('cumul us (USD | EUR)',
  (select string_agg(jour || '=' || cumul || '|' || cumul_eur, ' ' order by jour) from public.v_cash_cumul where marche = 'us'),
  '2026-10-01=997.00|888.33');
select tests.egal('cumul total en euros',
  (select string_agg(jour || '=' || cumul_eur, ' ' order by jour) from public.v_cash_cumul where marche = 'total'),
  '2026-09-08=570.00 2026-09-15=760.00 2026-09-16=950.00 2026-09-17=760.00 2026-09-24=950.00 2026-10-01=3298.33 2026-10-02=4578.33');
select tests.egal('cumul total : cumul = cumul_eur',
  (select count(*) from public.v_cash_cumul where marche = 'total' and cumul <> cumul_eur), 0::bigint);

-- ---------------------------------------------------------------------
-- v_cash_mensuel
-- ---------------------------------------------------------------------
select tests.egal('mensuel ' || m.marche || ' ' || to_char(m.mois, 'YYYY-MM'),
  concat_ws('|', m.devise, m.montant, m.montant_eur, m.nb_paiements), t.attendu)
  from public.v_cash_mensuel m
  join (values
    ('fr', '2026-09-01'::date, 'EUR|950.00|950.00|5'),
    ('fr', '2026-10-01'::date, 'EUR|2740.00|2740.00|4'),
    ('us', '2026-10-01'::date, 'USD|997.00|888.33|2')
  ) as t (marche, mois, attendu) on t.marche = m.marche and t.mois = m.mois;
select tests.egal('v_cash_mensuel : 3 lignes', (select count(*) from public.v_cash_mensuel), 3::bigint);
:en_postgres
