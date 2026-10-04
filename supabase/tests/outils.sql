-- Outils de test : chaque assertion écrit « ok - … » ou « ECHEC - … » (NOTICE),
-- run.sh compte les résultats. Les NOTICE survivent aux ROLLBACK des scénarios.

create schema if not exists tests;
grant usage on schema tests to public;

-- Assertion de base
create or replace function tests.ok(p_nom text, p_cond boolean, p_detail text default null) returns void
language plpgsql as $$
begin
  if coalesce(p_cond, false) then
    raise notice 'ok - %', p_nom;
  else
    raise notice 'ECHEC - %', p_nom || coalesce(' (' || p_detail || ')', '');
  end if;
end $$;

-- Égalité (null = null compte comme égal)
create or replace function tests.egal(p_nom text, p_obtenu anycompatible, p_attendu anycompatible) returns void
language plpgsql as $$
begin
  perform tests.ok(p_nom, p_obtenu is not distinct from p_attendu,
                   format('obtenu %s, attendu %s', coalesce(p_obtenu::text, 'null'), coalesce(p_attendu::text, 'null')));
end $$;

-- La requête doit échouer (avec ce code d'erreur si p_etat est donné)
create or replace function tests.echoue(p_nom text, p_sql text, p_etat text default null) returns void
language plpgsql as $$
begin
  execute p_sql;
  perform tests.ok(p_nom, false, 'la requête est passée alors qu''elle devait être refusée');
exception when others then
  if p_etat is null or sqlstate = p_etat then
    perform tests.ok(p_nom || ' [' || sqlstate || ']', true);
  else
    perform tests.ok(p_nom, false, format('erreur %s au lieu de %s : %s', sqlstate, p_etat, sqlerrm));
  end if;
end $$;

-- La requête doit passer
create or replace function tests.passe(p_nom text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  perform tests.ok(p_nom, true);
exception when others then
  perform tests.ok(p_nom, false, format('erreur %s : %s', sqlstate, sqlerrm));
end $$;

-- Nombre de lignes touchées par un INSERT / UPDATE / DELETE
create or replace function tests.nb(p_sql text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- Nombre de lignes visibles dans une table ou une vue
create or replace function tests.compte(p_rel text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I', p_rel) into n;
  return n;
end $$;

-- Ne voit rien : 0 ligne, ou accès refusé
create or replace function tests.ne_voit_rien(p_qui text, p_rel text) returns void
language plpgsql as $$
declare n bigint;
begin
  n := tests.compte(p_rel);
  perform tests.ok(format('%s ne voit rien dans %s', p_qui, p_rel), n = 0, format('%s lignes visibles', n));
exception when insufficient_privilege then
  perform tests.ok(format('%s ne voit rien dans %s (accès refusé)', p_qui, p_rel), true);
end $$;

grant execute on all functions in schema tests to public;

-- Toutes les tables et vues du contrat
create table tests.relations (nom text primary key);
insert into tests.relations values
  ('profils'), ('reglages'), ('clients'), ('abonnements'), ('paiements'), ('objectifs'), ('couts'),
  ('appels'), ('actions'), ('autonomie'), ('messages'), ('rapports'), ('agents_etat'), ('journal'),
  ('promotion_possible'), ('v_cash_mensuel'), ('v_cash_resume'), ('v_cash_attendu'), ('v_cash_cumul'),
  ('v_seuils'), ('v_partage');
grant select on tests.relations to public;

-- Identités simulées (le JWT est simulé par request.jwt.claim.sub)
\set en_postgres 'reset role; set request.jwt.claim.sub = '''';'
\set en_anon 'reset role; set request.jwt.claim.sub = ''''; set role anon;'
\set en_service 'reset role; set request.jwt.claim.sub = ''''; set role service_role;'
\set en_jay 'reset role; set request.jwt.claim.sub = ''11111111-1111-4111-8111-111111111111''; set role authenticated;'
\set en_junior 'reset role; set request.jwt.claim.sub = ''22222222-2222-4222-8222-222222222222''; set role authenticated;'
\set en_inconnu 'reset role; set request.jwt.claim.sub = ''33333333-3333-4333-8333-333333333333''; set role authenticated;'

-- Date de référence des calculs « mois courant »
\set ref '''2026-10-03 12:00+02''::timestamptz'
