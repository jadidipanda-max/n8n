-- Stub minimal de Supabase pour tester la migration sur un Postgres local.
-- Reproduit : schéma auth (auth.users, auth.uid()), rôles anon / authenticated /
-- service_role, droits par défaut de Supabase, schéma extensions et publication realtime.

-- Rôles (créés une fois par cluster)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator nologin noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;

-- Extensions dans leur schéma, comme sur Supabase
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Schéma auth simulé
create schema if not exists auth;
create table if not exists auth.users (
  id                 uuid primary key,
  email              text unique,
  aud                varchar(255),
  role               varchar(255),
  raw_user_meta_data jsonb default '{}',
  created_at         timestamptz default now()
);

-- Comme Supabase : l'identifiant vient du JWT (request.jwt.claim.sub ou request.jwt.claims)
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- Droits usuels de Supabase sur le schéma public
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Publication vide utilisée par Supabase Realtime
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
