-- 05 · Seuils TVA et micro (prorata de l'année de création), partage du résultat.
-- Date de référence : 3 octobre 2026, 12:00 à Paris.
--
-- Création le 1er août 2026 : du 1/08 au 31/12 inclus = 31 + 30 + 31 + 30 + 31 = 153 jours sur 365.
--   tva_base      37 500 × 153 / 365 = 15 719,18
--   tva_majore    41 250 × 153 / 365 = 17 291,10
--   plafond_micro 83 600 × 153 / 365 = 35 043,29
-- CA 2026 des données d'exemple : France 3 690 €, total 3 690 + 888,33 = 4 578,33 €.
--
-- Date réelle de création de la micro de Jay : 19 juillet 2026, valeur par défaut de la migration.
-- Du 19/07 au 31/12 inclus = 13 + 31 + 30 + 31 + 30 + 31 = 166 jours sur 365.
--   tva_base 17 054,79 · tva_majore 18 760,27 · plafond_micro 38 020,82
:en_jay
select tests.egal('date de création par défaut (19 juillet 2026) : 166 jours',
  (select concat_ws('|', jours_activite, tva_base, tva_majore, plafond_micro) from public.seuils_au(:ref)),
  '166|17054.79|18760.27|38020.82');

-- La suite du fichier garde son scénario de calcul d'origine (création au 1er août).
:en_postgres
update public.reglages set valeur = jsonb_set(valeur, '{date_creation}', '"2026-08-01"') where cle = 'seuils';
:en_jay

-- ---------------------------------------------------------------------
-- v_seuils (via seuils_au)
-- ---------------------------------------------------------------------
select tests.egal('seuils 2026 : ' || k, v, a) from (
  select s.* from public.seuils_au(:ref) s
) s, lateral (values
  ('annee',          s.annee::text,          '2026'),
  ('jours_activite', s.jours_activite::text, '153'),
  ('jours_annee',    s.jours_annee::text,    '365'),
  ('tva_base',       s.tva_base::text,       '15719.18'),
  ('tva_majore',     s.tva_majore::text,     '17291.10'),
  ('plafond_micro',  s.plafond_micro::text,  '35043.29'),
  ('ca_france_eur',  s.ca_france_eur::text,  '3690.00'),
  ('ca_total_eur',   s.ca_total_eur::text,   '4578.33'),
  ('alerte_tva',     s.alerte_tva,           'ok'),
  ('alerte_micro',   s.alerte_micro,         'ok')
) as t (k, v, a);

select tests.egal('v_seuils : une seule ligne', (select count(*) from public.v_seuils), 1::bigint);
select tests.egal('v_seuils = seuils_au(now())',
  (select count(*) from (select * from public.v_seuils except select * from public.seuils_au(now())) d), 0::bigint);

-- Années suivantes : année pleine, 366 jours en année bissextile
select tests.egal('seuils 2027 : année pleine (365/365, seuils entiers)',
  (select concat_ws('|', annee, jours_activite, jours_annee, tva_base, tva_majore, plafond_micro, ca_total_eur)
     from public.seuils_au('2027-03-01 12:00+01')),
  '2027|365|365|37500.00|41250.00|83600.00|0');
select tests.egal('seuils 2028 : année bissextile (366/366)',
  (select concat_ws('|', annee, jours_activite, jours_annee, tva_base) from public.seuils_au('2028-06-01 12:00+02')),
  '2028|366|366|37500.00');

-- Changement de jour de création (bornes du cahier des charges)
begin;
update public.reglages set valeur = jsonb_set(valeur, '{date_creation}', '"2026-08-31"') where cle = 'seuils';
select tests.egal('création le 31 août : 123 jours, TVA due dès 13 900,68, plafond 28 172,05',
  (select concat_ws('|', jours_activite, tva_base, tva_majore, plafond_micro) from public.seuils_au(:ref)),
  '123|12636.99|13900.68|28172.05');
update public.reglages set valeur = jsonb_set(valeur, '{date_creation}', '"2028-03-01"') where cle = 'seuils';
select tests.egal('création le 1er mars d''une année bissextile : 306 jours sur 366',
  (select concat_ws('|', jours_activite, jours_annee, tva_base) from public.seuils_au('2028-06-01 12:00+02')),
  '306|366|31352.46');
rollback;
:en_jay

-- Alertes : on ajoute des paiements fictifs (clé secrète) et on regarde le niveau
begin;
:en_postgres
-- 80 % de 15 719,18 = 12 575,344 : 3 690 + 8 885,35 = 12 575,35 → proche
insert into public.paiements (stripe_event_id, marche, type, montant, devise, paye_le)
values ('evt_seuil_1', 'fr', 'ponctuel', 8885.35, 'EUR', '2026-10-02 12:00+02');
:en_jay
select tests.egal('CA France à 80 % du seuil de base : proche',
  (select ca_france_eur || '|' || alerte_tva from public.seuils_au(:ref)), '12575.35|proche');
:en_postgres
update public.paiements set montant = 8885.34 where stripe_event_id = 'evt_seuil_1';
:en_jay
select tests.egal('CA France 12 575,34 (sous 80 %) : ok',
  (select ca_france_eur || '|' || alerte_tva from public.seuils_au(:ref)), '12575.34|ok');
:en_postgres
-- exactement le seuil de base (15 719,18) : pas encore dépassé
update public.paiements set montant = 12029.18 where stripe_event_id = 'evt_seuil_1';
:en_jay
select tests.egal('CA France = seuil de base : encore proche',
  (select ca_france_eur || '|' || alerte_tva from public.seuils_au(:ref)), '15719.18|proche');
:en_postgres
update public.paiements set montant = 12029.19 where stripe_event_id = 'evt_seuil_1';
:en_jay
select tests.egal('CA France 1 centime au-dessus du seuil de base : base_depassee',
  (select alerte_tva from public.seuils_au(:ref)), 'base_depassee');
:en_postgres
update public.paiements set montant = 13601.10 where stripe_event_id = 'evt_seuil_1';
:en_jay
select tests.egal('CA France = seuil majoré (17 291,10) : encore base_depassee',
  (select ca_france_eur || '|' || alerte_tva from public.seuils_au(:ref)), '17291.10|base_depassee');
:en_postgres
update public.paiements set montant = 13601.11 where stripe_event_id = 'evt_seuil_1';
:en_jay
select tests.egal('CA France au-dessus du seuil majoré : tva_due',
  (select alerte_tva from public.seuils_au(:ref)), 'tva_due');
select tests.egal('micro encore ok (17 291,11 + 888,33 = 18 179,44 < 28 034,63)',
  (select ca_total_eur || '|' || alerte_micro from public.seuils_au(:ref)), '18179.44|ok');
:en_postgres
-- Les paiements US comptent pour la micro, pas pour la TVA France
-- 80 % de 35 043,29 = 28 034,632 : il manque 9 855,20 € = 11 060,83 $ au taux 0,891
insert into public.paiements (stripe_event_id, marche, type, montant, devise, taux_eur, paye_le)
values ('evt_seuil_2', 'us', 'ponctuel', 11060.83, 'USD', 0.891, '2026-10-02 12:00-04');
:en_jay
select tests.egal('CA total à 80 % du plafond micro : proche (US compris)',
  (select ca_total_eur || '|' || alerte_micro from public.seuils_au(:ref)), '28034.64|proche');
select tests.egal('le CA US ne touche pas le CA France',
  (select ca_france_eur from public.seuils_au(:ref)), 17291.11);
:en_postgres
update public.paiements set montant = 20000 where stripe_event_id = 'evt_seuil_2';
:en_jay
select tests.egal('CA total au-dessus du plafond micro (18 179,44 + 17 820) : depasse',
  (select ca_total_eur || '|' || alerte_micro from public.seuils_au(:ref)), '35999.44|depasse');
:en_postgres
-- Le 1er janvier 2027 à 00:30 à Paris compte pour 2027, pas pour 2026
insert into public.paiements (stripe_event_id, marche, type, montant, devise, paye_le)
values ('evt_seuil_3', 'fr', 'ponctuel', 500, 'EUR', '2026-12-31 23:30:00+00');
:en_jay
select tests.egal('paiement du 1er janv. 00:30 (Paris) hors CA 2026',
  (select ca_france_eur from public.seuils_au(:ref)), 17291.11);
select tests.egal('… mais dans le CA 2027',
  (select ca_france_eur || '|' || alerte_tva from public.seuils_au('2027-02-01 12:00+01')), '500.00|ok');
rollback;
:en_jay

-- ---------------------------------------------------------------------
-- v_partage (via partage_au) : partage du résultat, jamais du cash
--   octobre : cash 2 740 + 888,33 = 3 628,33 ; cotisations 25,6 % = 928,85 ;
--             coûts 8,65 + 23 + 22 + 10 + 1,35 = 65,00 ; résultat 2 634,48 ; 1 317,24 chacun.
--   année   : cash 4 578,33 ; cotisations 1 172,05 ; coûts 65 + 10 = 75,00 ;
--             résultat 3 331,28 ; 1 665,64 chacun.
-- ---------------------------------------------------------------------
select tests.egal('partage ' || p.periode,
  concat_ws('|', p.debut, p.fin, p.cash_eur, p.cotisations_eur, p.couts_eur, p.resultat_eur, p.part_jay_eur, p.part_junior_eur),
  t.attendu)
  from public.partage_au(:ref) p
  join (values
    ('mois',  '2026-10-01|2026-10-31|3628.33|928.85|65.00|2634.48|1317.24|1317.24'),
    ('annee', '2026-01-01|2026-10-31|4578.33|1172.05|75.00|3331.28|1665.64|1665.64')
  ) as t (periode, attendu) on t.periode = p.periode;
select tests.egal('partage : 2 lignes (mois, annee)',
  (select string_agg(periode, ',' order by periode) from public.partage_au(:ref)), 'annee,mois');
select tests.egal('partage au 20 sept. : mois = année (950 − 243,20 − 10 = 696,80)',
  (select string_agg(concat_ws('|', periode, cash_eur, cotisations_eur, couts_eur, resultat_eur, part_jay_eur), ' ' order by periode)
     from public.partage_au('2026-09-20 12:00+02')),
  'annee|950.00|243.20|10.00|696.80|348.40 mois|950.00|243.20|10.00|696.80|348.40');
select tests.egal('v_partage = partage_au(now())',
  (select count(*) from (select * from public.v_partage except select * from public.partage_au(now())) d), 0::bigint);
select tests.egal('v_partage : 2 lignes', (select count(*) from public.v_partage), 2::bigint);

-- Les réglages pilotent le calcul (Jay seul peut les changer)
begin;
update public.reglages set valeur = '{"jay": 0.6, "junior": 0.4, "base": "apres_cotisations_et_couts"}' where cle = 'partage';
update public.reglages set valeur = '{"taux": 0.212, "regime": "BIC"}' where cle = 'cotisations';
-- octobre : cotisations 3 628,33 × 0,212 = 769,21 ; résultat 3 628,33 − 769,21 − 65 = 2 794,12 ; 60 % = 1 676,47 ; 40 % = 1 117,65
select tests.egal('partage 60/40 et cotisations à 21,2 %',
  (select concat_ws('|', cotisations_eur, resultat_eur, part_jay_eur, part_junior_eur) from public.partage_au(:ref) where periode = 'mois'),
  '769.21|2794.12|1676.47|1117.65');
rollback;
:en_jay
begin;
:en_postgres
-- Un remboursement fait baisser le cash, donc le résultat partagé
insert into public.paiements (stripe_event_id, marche, type, montant, devise, paye_le)
values ('evt_partage_rbt', 'fr', 'remboursement', -290, 'EUR', '2026-10-03 10:00+02');
:en_jay
select tests.egal('remboursement de 290 € : cash 3 338,33, résultat 2 418,72',
  (select concat_ws('|', cash_eur, cotisations_eur, resultat_eur) from public.partage_au(:ref) where periode = 'mois'),
  '3338.33|854.61|2418.72');
rollback;
:en_postgres
