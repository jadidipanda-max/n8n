-- =====================================================================
-- Cockpit J-Square : schéma, droits (RLS), fonctions et vues de cash.
-- Contrat : cockpit/CONTRAT-TECHNIQUE.md, sections 1.1 à 1.6.
-- Idempotente : on peut la recoller dans l'éditeur SQL de Supabase.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1.1 Profils (Jay = admin, Junior = associé)
-- ---------------------------------------------------------------------
create table if not exists public.profils (
  id      uuid primary key references auth.users (id) on delete cascade,
  nom     text not null,
  role    text not null check (role in ('admin', 'associe')),
  marche  text check (marche in ('fr', 'us')),
  cree_le timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 1.2 Tables
-- ---------------------------------------------------------------------
create table if not exists public.reglages (
  cle    text primary key,
  valeur jsonb not null,
  maj    timestamptz default now()
);

create table if not exists public.clients (
  id                 uuid primary key default gen_random_uuid(),
  marche             text not null check (marche in ('fr', 'us')),
  nom                text not null,
  niche              text,
  palier             text,
  prix_mensuel       numeric(12,2),
  devise             text not null check (devise in ('EUR', 'USD')),
  mise_en_place      numeric(12,2) default 0,
  debut              date,
  fin_engagement     date,
  objectif_garantie  text,
  objectif_valeur    numeric,
  resultat_valeur    numeric default 0,
  prochain_point     timestamptz,
  point_booke        boolean default false,
  stripe_customer_id text unique,
  statut             text default 'actif' check (statut in ('actif', 'pause', 'termine')),
  owner_id           uuid references public.profils (id) default auth.uid(),
  cree_le            timestamptz default now(),
  maj                timestamptz default now()
);

create table if not exists public.abonnements (
  id                     uuid primary key default gen_random_uuid(),
  stripe_subscription_id text unique not null,
  stripe_customer_id     text,
  client_id              uuid references public.clients (id),
  marche                 text check (marche in ('fr', 'us')),
  statut                 text not null,
  montant                numeric(12,2) not null,
  devise                 text not null,
  intervalle_mois        int not null default 1,
  debut                  timestamptz,
  fin_engagement         timestamptz,
  prochaine_facture      timestamptz,
  annule_le              timestamptz,
  maj                    timestamptz default now()
);

create table if not exists public.paiements (
  id                 uuid primary key default gen_random_uuid(),
  stripe_event_id    text unique not null,
  stripe_invoice_id  text,
  stripe_customer_id text,
  client_id          uuid references public.clients (id),
  marche             text not null check (marche in ('fr', 'us')),
  type               text not null check (type in ('abonnement', 'mise_en_place', 'pack', 'ponctuel', 'remboursement', 'litige')),
  montant            numeric(12,2) not null,
  devise             text not null check (devise in ('EUR', 'USD')),
  taux_eur           numeric(12,6) not null default 1,
  montant_eur        numeric(12,2) generated always as (round(montant * taux_eur, 2)) stored,
  paye_le            timestamptz not null,
  description        text,
  cree_le            timestamptz default now()
);

create table if not exists public.objectifs (
  id             uuid primary key default gen_random_uuid(),
  mois           date not null,
  marche         text not null check (marche in ('fr', 'us')),
  clients_vises  int not null,
  cash_vise      numeric(12,2) not null,
  devise         text not null,
  calcule_par    text,
  maj            timestamptz default now(),
  unique (mois, marche)
);

create table if not exists public.couts (
  id          uuid primary key default gen_random_uuid(),
  mois        date not null,
  poste       text not null,
  montant_eur numeric(12,2) not null,
  unique (mois, poste)
);

create table if not exists public.appels (
  id        uuid primary key default gen_random_uuid(),
  marche    text not null check (marche in ('fr', 'us')),
  ecran     text not null,
  lead_ref  text not null,
  statut    text,
  note      text,
  rappel_le timestamptz,
  maj       timestamptz default now(),
  owner_id  uuid references public.profils (id) default auth.uid(),
  unique (ecran, lead_ref)
);

create table if not exists public.actions (
  id          uuid primary key default gen_random_uuid(),
  marche      text check (marche in ('fr', 'us')),
  agent       text not null,
  type_action text not null,
  titre       text not null,
  details     jsonb default '{}',
  statut      text not null default 'en_attente' check (statut in ('en_attente', 'validee', 'refusee', 'executee', 'erreur')),
  auto        boolean default false,
  cree_le     timestamptz default now(),
  decide_par  uuid references public.profils (id),
  decide_le   timestamptz,
  correction  text
);

create table if not exists public.autonomie (
  agent          text not null,
  type_action    text not null,
  niveau         int not null default 0 check (niveau between 0 and 2),
  verrou         boolean not null default false,
  ok_consecutifs int not null default 0,
  maj            timestamptz default now(),
  primary key (agent, type_action),
  -- une action verrouillée reste toujours au niveau 0
  constraint autonomie_verrou_niveau_0 check (not verrou or niveau = 0)
);

create table if not exists public.messages (
  id        uuid primary key default gen_random_uuid(),
  auteur    text not null check (auteur in ('jay', 'junior', 'hermes', 'systeme')),
  auteur_id uuid references public.profils (id) default auth.uid(),
  marche    text check (marche in ('fr', 'us')),
  type      text not null default 'message' check (type in ('message', 'rapport', 'alerte')),
  contenu   text not null check (char_length(contenu) <= 8000),
  meta      jsonb default '{}',
  cree_le   timestamptz default now()
);

create table if not exists public.rapports (
  id      uuid primary key default gen_random_uuid(),
  jour    date unique not null,
  verdict text not null check (verdict in ('tenir', 'ajuster_prix', 'changer_niche', 'changer_offre', 'alerte')),
  resume  text not null,
  contenu text not null,
  donnees jsonb default '{}',
  cree_le timestamptz default now()
);

create table if not exists public.agents_etat (
  agent               text primary key,
  nom                 text not null,
  marche              text,
  statut              text not null check (statut in ('run', 'wait', 'idle', 'ok', 'err')),
  derniere_phrase     text,
  derniere_execution  timestamptz,
  prochaine_execution timestamptz,
  cout_jour_eur       numeric(10,2) default 0,
  maj                 timestamptz default now()
);

create table if not exists public.journal (
  id      uuid primary key default gen_random_uuid(),
  marche  text,
  agent   text not null,
  texte   text not null,
  cree_le timestamptz default now()
);

-- Index
create index if not exists paiements_paye_le_idx        on public.paiements (paye_le);
create index if not exists paiements_marche_paye_le_idx on public.paiements (marche, paye_le);
create index if not exists journal_cree_le_idx          on public.journal (cree_le desc);
create index if not exists messages_cree_le_idx         on public.messages (cree_le desc);
create index if not exists actions_statut_cree_le_idx   on public.actions (statut, cree_le);
create index if not exists messages_auteur_cree_le_idx  on public.messages (auteur_id, cree_le desc);

-- Base créée avant l'ajout du contrôle : appels.marche vaut fr ou us
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.appels'::regclass and conname = 'appels_marche_check') then
    alter table public.appels add constraint appels_marche_check check (marche in ('fr', 'us'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1.1 Fonctions d'identité (utilisées par les règles RLS)
-- ---------------------------------------------------------------------
create or replace function public.est_membre() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profils where id = auth.uid());
$$;

create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profils where id = auth.uid() and role = 'admin');
$$;

create or replace function public.mon_marche() returns text
language sql stable security definer set search_path = public as $$
  select marche from public.profils where id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- Triggers utilitaires
-- ---------------------------------------------------------------------
-- Met à jour la colonne maj à chaque modification
create or replace function public.touche_maj() returns trigger
language plpgsql set search_path = public as $$
begin
  new.maj := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['reglages', 'clients', 'abonnements', 'objectifs', 'appels', 'autonomie', 'agents_etat'] loop
    execute format('create or replace trigger %I before update on public.%I for each row execute function public.touche_maj()',
                   t || '_maj', t);
  end loop;
end $$;

-- Relie un paiement ou un abonnement Stripe à sa fiche client (par stripe_customer_id)
create or replace function public.relier_client() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is null and new.stripe_customer_id is not null then
    select c.id into new.client_id from public.clients c where c.stripe_customer_id = new.stripe_customer_id;
  end if;
  return new;
end;
$$;

create or replace trigger paiements_relier_client before insert or update on public.paiements
  for each row execute function public.relier_client();
create or replace trigger abonnements_relier_client before insert or update on public.abonnements
  for each row execute function public.relier_client();

-- Fiche client ajoutée (ou reliée à Stripe) après ses premiers paiements : on rattache l'historique
create or replace function public.rattacher_historique_client() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stripe_customer_id is not null then
    update public.paiements   set client_id = new.id
     where stripe_customer_id = new.stripe_customer_id and client_id is null;
    update public.abonnements set client_id = new.id
     where stripe_customer_id = new.stripe_customer_id and client_id is null;
  end if;
  return null;
end;
$$;

create or replace trigger clients_rattacher_historique after insert or update of stripe_customer_id on public.clients
  for each row execute function public.rattacher_historique_client();

-- Fiches clients : seul l'admin (ou n8n) relie une fiche à Stripe ;
-- une fiche créée par n8n appartient à l'associé de son marché.
create or replace function public.clients_avant_ecriture() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.est_admin() then
    if (tg_op = 'INSERT' and new.stripe_customer_id is not null)
       or (tg_op = 'UPDATE' and new.stripe_customer_id is distinct from old.stripe_customer_id) then
      raise exception 'Seul Jay (admin) peut relier une fiche client à Stripe.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'INSERT' and new.owner_id is null then
    select p.id into new.owner_id from public.profils p where p.marche = new.marche order by p.cree_le, p.id limit 1;
  end if;
  return new;
end;
$$;

create or replace trigger clients_avant_ecriture before insert or update on public.clients
  for each row execute function public.clients_avant_ecriture();

-- Messages écrits par Jay ou Junior : date posée par la base (jamais dans le futur)
-- et 30 messages par minute au plus, même en passant à côté du serveur du cockpit.
create or replace function public.messages_avant_ajout() returns trigger
language plpgsql set search_path = public as $$
declare
  v_nb int;
begin
  if auth.uid() is not null and new.auteur in ('jay', 'junior') then
    new.cree_le := now();
    select count(*) into v_nb from public.messages
     where auteur_id = new.auteur_id and cree_le > now() - interval '1 minute';
    if v_nb >= 30 then
      raise exception 'Trop de messages d''un coup : attends une minute.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger messages_avant_ajout before insert on public.messages
  for each row execute function public.messages_avant_ajout();

-- ---------------------------------------------------------------------
-- 1.3 Réglages (n'écrase jamais une valeur déjà modifiée)
-- ---------------------------------------------------------------------
insert into public.reglages (cle, valeur) values
  ('seuils',           '{"tva_base": 37500, "tva_majore": 41250, "plafond_micro": 83600, "date_creation": "2026-08-01", "annee_seuils": 2026}'),
  ('cotisations',      '{"taux": 0.256, "regime": "BNC"}'),
  ('change',           '{"usd_eur": 0.891, "source": "BCE 2026-10-02"}'),
  ('objectif_mensuel', '{"fr": 6, "us": 6}'),
  ('partage',          '{"jay": 0.5, "junior": 0.5, "base": "apres_cotisations_et_couts"}')
on conflict (cle) do nothing;

-- ---------------------------------------------------------------------
-- 1.4 RLS
-- ---------------------------------------------------------------------
-- Lecture : seulement les membres (Jay et Junior), sur toutes les tables
do $$
declare t text;
begin
  foreach t in array array['profils', 'reglages', 'clients', 'abonnements', 'paiements', 'objectifs', 'couts',
                           'appels', 'actions', 'autonomie', 'messages', 'rapports', 'agents_etat', 'journal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lecture_membres on public.%I', t);
    execute format('create policy lecture_membres on public.%I for select to authenticated using (public.est_membre())', t);
  end loop;
end $$;

-- clients et appels : l'admin, ou le propriétaire de la ligne sur son propre marché
do $$
declare t text;
begin
  foreach t in array array['clients', 'appels'] loop
    execute format('drop policy if exists ajout_proprietaire on public.%I', t);
    execute format('drop policy if exists modif_proprietaire on public.%I', t);
    execute format('drop policy if exists suppr_proprietaire on public.%I', t);
    execute format('create policy ajout_proprietaire on public.%I for insert to authenticated
                      with check (public.est_admin() or (owner_id = (select auth.uid()) and marche = public.mon_marche()))', t);
    execute format('create policy modif_proprietaire on public.%I for update to authenticated
                      using (public.est_admin() or (owner_id = (select auth.uid()) and marche = public.mon_marche()))
                      with check (public.est_admin() or (owner_id = (select auth.uid()) and marche = public.mon_marche()))', t);
    execute format('create policy suppr_proprietaire on public.%I for delete to authenticated
                      using (public.est_admin() or (owner_id = (select auth.uid()) and marche = public.mon_marche()))', t);
  end loop;
end $$;

-- messages : chacun n'écrit qu'en son nom (jay pour l'admin, junior pour l'associé)
drop policy if exists ajout_mes_messages on public.messages;
create policy ajout_mes_messages on public.messages for insert to authenticated
  with check (
    auteur_id = (select auth.uid())
    and public.est_membre()
    and auteur = case when public.est_admin() then 'jay' else 'junior' end
    and type = 'message'
    and coalesce(meta, '{}'::jsonb) = '{}'::jsonb
  );

-- reglages, objectifs, couts : l'admin seulement
do $$
declare t text;
begin
  foreach t in array array['reglages', 'objectifs', 'couts'] loop
    execute format('drop policy if exists ajout_admin on public.%I', t);
    execute format('drop policy if exists modif_admin on public.%I', t);
    execute format('create policy ajout_admin on public.%I for insert to authenticated with check (public.est_admin())', t);
    execute format('create policy modif_admin on public.%I for update to authenticated
                      using (public.est_admin()) with check (public.est_admin())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1.5 File « À valider » et autonomie
-- ---------------------------------------------------------------------
-- Types d'action toujours verrouillés (argent, prix, contrat, premier message à un client).
-- Le type est normalisé (minuscules, sans accents, séparateur « _ ») puis comparé à une liste
-- et à des familles de mots : « Changer_prix », « rembourser_client » ou « envoyer_paiement »
-- restent verrouillés.
create or replace function public.type_action_verrouille(p_type text) returns boolean
language sql immutable set search_path = public as $$
  with t as (
    select regexp_replace(translate(lower(btrim(coalesce(p_type, ''))), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'),
                          '[^a-z0-9]+', '_', 'g') as v
  )
  select t.v in ('relance_impaye', 'changer_prix', 'envoyer_argent', 'rembourser', 'mission_apify',
                 'envoyer_contrat', 'signer_contrat', 'premier_message')
      or t.v ~ '(^|_)(rembours[a-z]*|payer|paye|paiement|paiements|virement|argent|impaye|impayes|litige|contrat|contrats|apify|premier_message)(_|$)'
      or t.v ~ '(^|_)(changer|modifier|baisser|monter|augmenter|reduire|fixer|appliquer)_([a-z0-9]+_)*(prix|tarif|tarifs|remise)(_|$)'
    from t;
$$;

-- À chaque nouvelle action : ligne d'autonomie créée si besoin, verrou appliqué,
-- « auto » refusé si l'autonomie ne le permet pas, et une ligne de journal.
create or replace function public.actions_avant_ajout() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_verrou boolean;
  v_auto   public.autonomie;
begin
  v_verrou := public.type_action_verrouille(new.type_action) or coalesce(new.details ->> 'verrou', '') = 'true';
  insert into public.autonomie (agent, type_action, verrou)
  values (new.agent, new.type_action, v_verrou)
  on conflict (agent, type_action) do nothing;

  if v_verrou then
    update public.autonomie
       set verrou = true, niveau = 0, ok_consecutifs = 0
     where agent = new.agent and type_action = new.type_action and not verrou;
  end if;

  select * into v_auto from public.autonomie where agent = new.agent and type_action = new.type_action;

  -- autonome si niveau 2, ou niveau 1 après 5 OK d'affilée ; jamais si verrou
  if coalesce(new.auto, false) and not (
       not v_auto.verrou and (v_auto.niveau = 2 or (v_auto.niveau = 1 and v_auto.ok_consecutifs >= 5))
     ) then
    new.auto := false;
  end if;

  -- une action autonome ne passe jamais par la file « À valider »
  if new.auto and new.statut = 'en_attente' then
    new.statut := 'validee';
  end if;

  -- une action non autonome arrive toujours dans la file « À valider »
  if not coalesce(new.auto, false) then
    new.auto := false;
    new.statut := 'en_attente';
    new.decide_par := null;
    new.decide_le := null;
  end if;

  insert into public.journal (marche, agent, texte, cree_le)
  values (new.marche, new.agent,
          case when new.auto then 'Fait seul (autonomie) : ' else 'À valider : ' end || new.titre,
          coalesce(new.cree_le, now()));
  return new;
end;
$$;

create or replace trigger actions_avant_ajout before insert on public.actions
  for each row execute function public.actions_avant_ajout();

create or replace function public.decider_action(p_id uuid, p_ok boolean, p_correction text default null)
returns public.actions
language plpgsql security definer set search_path = public as $$
declare
  v_profil     public.profils;
  v_action     public.actions;
  v_correction text := nullif(btrim(coalesce(p_correction, '')), '');
begin
  select * into v_profil from public.profils where id = auth.uid();
  if not found then
    raise exception 'Accès refusé : ce compte n''a pas de profil dans le cockpit.' using errcode = '42501';
  end if;

  select * into v_action from public.actions where id = p_id for update;
  if not found then
    raise exception 'Action introuvable.' using errcode = 'P0002';
  end if;

  if v_action.statut <> 'en_attente' then
    raise exception 'Cette action a déjà été décidée (statut : %).', v_action.statut using errcode = 'P0001';
  end if;

  if v_profil.role <> 'admin' and (v_action.marche is null or v_action.marche is distinct from v_profil.marche) then
    raise exception 'Cette action ne fait pas partie de ton marché : seul l''admin peut la décider.' using errcode = '42501';
  end if;

  update public.actions
     set statut     = case when p_ok then 'validee' else 'refusee' end,
         decide_par = v_profil.id,
         decide_le  = now(),
         correction = v_correction
   where id = p_id
  returning * into v_action;

  insert into public.autonomie (agent, type_action, verrou)
  values (v_action.agent, v_action.type_action, public.type_action_verrouille(v_action.type_action))
  on conflict (agent, type_action) do nothing;

  if p_ok and v_correction is null then
    -- l'autonomie est commune aux deux marchés : seuls les OK de l'admin la font monter
    -- (sinon les OK de Junior sur les USA rendraient autonomes les actions France)
    if v_profil.role = 'admin' then
      update public.autonomie
         set ok_consecutifs = ok_consecutifs + 1
       where agent = v_action.agent and type_action = v_action.type_action;
    end if;
  else
    -- refus ou correction : le compteur repart de zéro et le niveau baisse d'un cran
    update public.autonomie
       set ok_consecutifs = 0, niveau = greatest(niveau - 1, 0)
     where agent = v_action.agent and type_action = v_action.type_action;
  end if;

  insert into public.journal (marche, agent, texte)
  values (v_action.marche, v_action.agent,
          case when not p_ok then 'Refusée par '
               when v_correction is not null then 'Validée avec correction par '
               else 'Validée par ' end
          || v_profil.nom || ' : ' || v_action.titre);

  return v_action;
end;
$$;

create or replace function public.changer_autonomie(p_agent text, p_type text, p_niveau int)
returns public.autonomie
language plpgsql security definer set search_path = public as $$
declare
  v_ligne public.autonomie;
  v_nom   text;
begin
  if not public.est_admin() then
    raise exception 'Seul l''admin peut changer les niveaux d''autonomie.' using errcode = '42501';
  end if;
  if p_niveau is null or p_niveau not between 0 and 2 then
    raise exception 'Le niveau doit être 0, 1 ou 2.' using errcode = '22023';
  end if;

  insert into public.autonomie (agent, type_action, verrou)
  values (p_agent, p_type, public.type_action_verrouille(p_type))
  on conflict (agent, type_action) do nothing;

  select * into v_ligne from public.autonomie where agent = p_agent and type_action = p_type for update;
  if public.type_action_verrouille(p_type) and not v_ligne.verrou then
    update public.autonomie set verrou = true, niveau = 0, ok_consecutifs = 0
     where agent = p_agent and type_action = p_type
    returning * into v_ligne;
  end if;
  if v_ligne.verrou and p_niveau > 0 then
    raise exception 'Action verrouillée : elle demande toujours une validation (niveau 0).' using errcode = 'P0001';
  end if;

  update public.autonomie
     set niveau = p_niveau, ok_consecutifs = 0
   where agent = p_agent and type_action = p_type
  returning * into v_ligne;

  select nom into v_nom from public.profils where id = auth.uid();
  insert into public.journal (marche, agent, texte)
  values (null, p_agent, 'Autonomie « ' || p_type || ' » : '
          || (array['toujours demander', 'autonome après 5 OK', 'autonome'])[p_niveau + 1]
          || ', décidé par ' || coalesce(v_nom, 'l''admin'));

  return v_ligne;
end;
$$;

create or replace view public.promotion_possible with (security_invoker = true) as
  select a.*
    from public.autonomie a
   where a.verrou = false and a.niveau < 2 and a.ok_consecutifs >= 5;

-- ---------------------------------------------------------------------
-- 1.6 Vues de cash
-- Les calculs « mois courant » sont des fonctions qui prennent la date de
-- référence en paramètre (testables) ; les vues les appellent avec now().
-- ---------------------------------------------------------------------
-- Garde des fonctions de cash : une personne connectée doit être membre ;
-- les rôles techniques (clé secrète, MCP en lecture seule) passent déjà outre la RLS.
create or replace function public.lecture_autorisee() returns boolean
language sql stable set search_path = public as $$
  select public.est_membre() or current_user not in ('anon', 'authenticated');
$$;

-- Taux de secours USD → EUR (reglages.change)
create or replace function public.taux_usd_eur() returns numeric
language sql stable set search_path = public as $$
  select (valeur ->> 'usd_eur')::numeric from public.reglages where cle = 'change';
$$;

create or replace function public.devise_marche(p_marche text) returns text
language sql immutable set search_path = public as $$
  select case p_marche when 'us' then 'USD' else 'EUR' end;
$$;

-- Conversion entre EUR et USD au taux des réglages
create or replace function public.convertir(p_montant numeric, p_de text, p_vers text) returns numeric
language sql stable set search_path = public as $$
  select case
    when p_montant is null then null
    when p_de = p_vers then p_montant
    when p_de = 'USD' and p_vers = 'EUR' then p_montant * public.taux_usd_eur()
    when p_de = 'EUR' and p_vers = 'USD' then p_montant / nullif(public.taux_usd_eur(), 0)
  end;
$$;

-- Montant d'un paiement dans la devise de son marché
create or replace function public.montant_marche(p_montant numeric, p_montant_eur numeric, p_devise text, p_marche text)
returns numeric
language sql stable set search_path = public as $$
  select case
    when p_devise = public.devise_marche(p_marche) then p_montant
    when public.devise_marche(p_marche) = 'EUR' then p_montant_eur
    else round(public.convertir(p_montant_eur, 'EUR', public.devise_marche(p_marche)), 2)
  end;
$$;

-- v_cash_mensuel : somme des paiements par marché et par mois (Europe/Paris)
create or replace view public.v_cash_mensuel with (security_invoker = true) as
  select p.marche,
         date_trunc('month', p.paye_le at time zone 'Europe/Paris')::date        as mois,
         public.devise_marche(p.marche)                                           as devise,
         sum(public.montant_marche(p.montant, p.montant_eur, p.devise, p.marche)) as montant,
         sum(p.montant_eur)                                                       as montant_eur,
         count(*)::int                                                            as nb_paiements
    from public.paiements p
   group by 1, 2, 3;

-- v_cash_cumul : courbe en escalier, un point par jour avec paiement
create or replace view public.v_cash_cumul with (security_invoker = true) as
  with jours as (
    select p.marche,
           (p.paye_le at time zone 'Europe/Paris')::date                            as jour,
           sum(public.montant_marche(p.montant, p.montant_eur, p.devise, p.marche)) as montant,
           sum(p.montant_eur)                                                       as montant_eur
      from public.paiements p
     group by 1, 2
    union all
    select 'total', (p.paye_le at time zone 'Europe/Paris')::date, sum(p.montant_eur), sum(p.montant_eur)
      from public.paiements p
     group by 2
  )
  select j.marche, j.jour,
         sum(j.montant)     over w as cumul,
         sum(j.montant_eur) over w as cumul_eur
    from jours j
  window w as (partition by j.marche order by j.jour);

-- Résumé du cash (fr, us, total) pour le mois qui contient p_ref
create or replace function public.cash_resume_au(p_ref timestamptz)
returns table (
  marche text, devise text,
  cash_mois numeric, cash_mois_eur numeric, cumul numeric, cumul_eur numeric, premier_paiement date,
  mrr numeric, mrr_eur numeric,
  objectif_cash numeric, objectif_clients int, clients_signes_mois int
)
language sql stable set search_path = public as $$
  with b as (
    select date_trunc('month', p_ref at time zone 'Europe/Paris')::date as mois
  ),
  pay as (
    select p.marche,
           date_trunc('month', p.paye_le at time zone 'Europe/Paris')::date        as mois,
           (p.paye_le at time zone 'Europe/Paris')::date                            as jour,
           public.montant_marche(p.montant, p.montant_eur, p.devise, p.marche) as montant,
           p.montant_eur
      from public.paiements p
  ),
  abo as (
    select coalesce(a.marche, case a.devise when 'USD' then 'us' else 'fr' end) as marche,
           a.montant / greatest(a.intervalle_mois, 1)                            as mensuel,
           a.devise
      from public.abonnements a
     where a.statut in ('active', 'trialing', 'past_due')
  ),
  m as (
    select x.marche, public.devise_marche(x.marche) as devise, b.mois
      from (values ('fr'), ('us')) as x (marche), b
  ),
  par_marche as (
    select m.marche, m.devise,
           coalesce((select sum(pay.montant)     from pay where pay.marche = m.marche and pay.mois = m.mois), 0)  as cash_mois,
           coalesce((select sum(pay.montant_eur) from pay where pay.marche = m.marche and pay.mois = m.mois), 0)  as cash_mois_eur,
           coalesce((select sum(pay.montant)     from pay where pay.marche = m.marche and pay.mois <= m.mois), 0) as cumul,
           coalesce((select sum(pay.montant_eur) from pay where pay.marche = m.marche and pay.mois <= m.mois), 0) as cumul_eur,
           (select min(pay.jour) from pay where pay.marche = m.marche and pay.mois <= m.mois)                    as premier_paiement,
           coalesce((select round(sum(public.convertir(abo.mensuel, abo.devise, m.devise)), 2)
                       from abo where abo.marche = m.marche), 0)                                                  as mrr,
           coalesce((select round(sum(public.convertir(abo.mensuel, abo.devise, 'EUR')), 2)
                       from abo where abo.marche = m.marche), 0)                                                  as mrr_eur,
           (select round(public.convertir(o.cash_vise, o.devise, m.devise), 2)
              from public.objectifs o
             where o.marche = m.marche and date_trunc('month', o.mois)::date = m.mois
             limit 1)                                                                                             as objectif_cash,
           coalesce((select o.clients_vises
                       from public.objectifs o
                      where o.marche = m.marche and date_trunc('month', o.mois)::date = m.mois
                      limit 1),
                    (select (r.valeur ->> m.marche)::int from public.reglages r where r.cle = 'objectif_mensuel')) as objectif_clients,
           (select count(*)::int
              from public.clients c
             where c.marche = m.marche
               and c.debut >= m.mois and c.debut < (m.mois + interval '1 month')::date)                          as clients_signes_mois
      from m
  )
  select * from (
    select pm.marche, pm.devise, pm.cash_mois, pm.cash_mois_eur, pm.cumul, pm.cumul_eur, pm.premier_paiement,
           pm.mrr, pm.mrr_eur, pm.objectif_cash, pm.objectif_clients, pm.clients_signes_mois
      from par_marche pm
    union all
    select 'total', 'EUR',
           sum(pm.cash_mois_eur), sum(pm.cash_mois_eur), sum(pm.cumul_eur), sum(pm.cumul_eur), min(pm.premier_paiement),
           sum(pm.mrr_eur), sum(pm.mrr_eur),
           round(sum(public.convertir(pm.objectif_cash, pm.devise, 'EUR')), 2),
           sum(pm.objectif_clients)::int, sum(pm.clients_signes_mois)::int
      from par_marche pm
  ) r
  where public.lecture_autorisee();
$$;

create or replace view public.v_cash_resume with (security_invoker = true) as
  select * from public.cash_resume_au(now());

-- Cash attendu sur les 3 mois qui suivent le mois de p_ref
create or replace function public.cash_attendu_au(p_ref timestamptz)
returns table (
  marche text, mois date, devise text,
  engage numeric, probable numeric, engage_eur numeric, probable_eur numeric
)
language sql stable set search_path = public as $$
  with b as (
    select date_trunc('month', p_ref at time zone 'Europe/Paris')::date as mois
  ),
  mois3 as (
    select (b.mois + make_interval(months => i))::date as mois from b, generate_series(1, 3) as i
  ),
  abo as (
    select coalesce(a.marche, case a.devise when 'USD' then 'us' else 'fr' end) as marche,
           a.montant, a.devise,
           greatest(a.intervalle_mois, 1)                 as intervalle,
           a.prochaine_facture at time zone 'Europe/Paris' as prochaine_locale,
           a.fin_engagement    at time zone 'Europe/Paris' as fin_locale,
           a.annule_le         at time zone 'Europe/Paris' as annule_locale
      from public.abonnements a
     where a.statut in ('active', 'trialing', 'past_due')
       and a.prochaine_facture is not null
  ),
  -- dates de facture futures : prochaine_facture + k × intervalle_mois
  factures as (
    select abo.marche, abo.montant, abo.devise, f.date_locale,
           date_trunc('month', f.date_locale)::date as mois,
           (abo.fin_locale is null or f.date_locale < abo.fin_locale) as engagee
      from abo
     cross join lateral (
       select abo.prochaine_locale + make_interval(months => k * abo.intervalle) as date_locale
         from generate_series(0, 48) as k
     ) f
     where (abo.annule_locale is null or f.date_locale < abo.annule_locale)
  ),
  par_marche as (
    select x.marche, d.mois, public.devise_marche(x.marche) as devise,
           coalesce(round(sum(public.convertir(f.montant, f.devise, public.devise_marche(x.marche))) filter (where f.engagee), 2), 0.00)     as engage,
           coalesce(round(sum(public.convertir(f.montant, f.devise, public.devise_marche(x.marche))) filter (where not f.engagee), 2), 0.00) as probable
      from (values ('fr'), ('us')) as x (marche)
     cross join mois3 d
      left join factures f on f.marche = x.marche and f.mois = d.mois
     group by x.marche, d.mois
  ),
  avec_eur as (
    select pm.*,
           round(public.convertir(pm.engage,   pm.devise, 'EUR'), 2) as engage_eur,
           round(public.convertir(pm.probable, pm.devise, 'EUR'), 2) as probable_eur
      from par_marche pm
  )
  select * from (
    select e.marche, e.mois, e.devise, e.engage, e.probable, e.engage_eur, e.probable_eur from avec_eur e
    union all
    select 'total', e.mois, 'EUR', sum(e.engage_eur), sum(e.probable_eur), sum(e.engage_eur), sum(e.probable_eur)
      from avec_eur e
     group by e.mois
  ) r
  where public.lecture_autorisee();
$$;

create or replace view public.v_cash_attendu with (security_invoker = true) as
  select * from public.cash_attendu_au(now());

-- Seuils TVA et micro-entreprise pour l'année civile de p_ref (prorata l'année de création)
create or replace function public.seuils_au(p_ref timestamptz)
returns table (
  annee int, ca_france_eur numeric, ca_total_eur numeric,
  jours_activite int, jours_annee int,
  tva_base numeric, tva_majore numeric, plafond_micro numeric,
  alerte_tva text, alerte_micro text
)
language sql stable set search_path = public as $$
  with a as (
    select extract(year from p_ref at time zone 'Europe/Paris')::int as annee
  ),
  s as (
    select r.valeur as v, (r.valeur ->> 'date_creation')::date as creation
      from public.reglages r where r.cle = 'seuils'
  ),
  ca as (
    select coalesce(sum(p.montant_eur) filter (where p.marche = 'fr'), 0) as ca_france_eur,
           coalesce(sum(p.montant_eur), 0)                                as ca_total_eur
      from public.paiements p, a
     where extract(year from p.paye_le at time zone 'Europe/Paris')::int = a.annee
  ),
  j as (
    select a.annee, s.v,
           (make_date(a.annee, 12, 31) - make_date(a.annee, 1, 1) + 1) as jours_annee,
           case
             when s.creation is null or extract(year from s.creation)::int < a.annee
               then make_date(a.annee, 12, 31) - make_date(a.annee, 1, 1) + 1
             when extract(year from s.creation)::int = a.annee
               then make_date(a.annee, 12, 31) - s.creation + 1
             else 0
           end as jours_activite
      from a, s
  ),
  t as (
    select j.annee, j.jours_activite, j.jours_annee,
           round((j.v ->> 'tva_base')::numeric      * j.jours_activite / j.jours_annee, 2) as tva_base,
           round((j.v ->> 'tva_majore')::numeric    * j.jours_activite / j.jours_annee, 2) as tva_majore,
           round((j.v ->> 'plafond_micro')::numeric * j.jours_activite / j.jours_annee, 2) as plafond_micro
      from j
  )
  select t.annee, ca.ca_france_eur, ca.ca_total_eur, t.jours_activite, t.jours_annee,
         t.tva_base, t.tva_majore, t.plafond_micro,
         case when ca.ca_france_eur > t.tva_majore     then 'tva_due'
              when ca.ca_france_eur > t.tva_base       then 'base_depassee'
              when ca.ca_france_eur >= 0.8 * t.tva_base then 'proche'
              else 'ok' end,
         case when ca.ca_total_eur > t.plafond_micro       then 'depasse'
              when ca.ca_total_eur >= 0.8 * t.plafond_micro then 'proche'
              else 'ok' end
    from t, ca
   where public.lecture_autorisee();
$$;

create or replace view public.v_seuils with (security_invoker = true) as
  select * from public.seuils_au(now());

-- Partage 50/50 sur le résultat (cash − cotisations − coûts), jamais sur le cash
create or replace function public.partage_au(p_ref timestamptz)
returns table (
  periode text, debut date, fin date,
  cash_eur numeric, cotisations_eur numeric, couts_eur numeric, resultat_eur numeric,
  part_jay_eur numeric, part_junior_eur numeric
)
language sql stable set search_path = public as $$
  with b as (
    select date_trunc('month', p_ref at time zone 'Europe/Paris')::date as mois
  ),
  per as (
    select 'mois'::text as periode, b.mois as debut, (b.mois + interval '1 month' - interval '1 day')::date as fin from b
    union all
    select 'annee', date_trunc('year', b.mois)::date, (b.mois + interval '1 month' - interval '1 day')::date from b
  ),
  reg as (
    select (select (valeur ->> 'taux')::numeric from public.reglages where cle = 'cotisations') as taux,
           (select valeur from public.reglages where cle = 'partage')                         as partage
  ),
  calc as (
    select per.periode, per.debut, per.fin, reg.partage,
           coalesce((select sum(p.montant_eur) from public.paiements p
                      where (p.paye_le at time zone 'Europe/Paris')::date between per.debut and per.fin), 0) as cash_eur,
           coalesce((select sum(c.montant_eur) from public.couts c
                      where c.mois between per.debut and per.fin), 0)                                         as couts_eur,
           reg.taux
      from per, reg
  ),
  res as (
    select calc.*, round(calc.cash_eur * coalesce(calc.taux, 0), 2) as cotisations_eur from calc
  )
  select res.periode, res.debut, res.fin, res.cash_eur, res.cotisations_eur, res.couts_eur,
         res.cash_eur - res.cotisations_eur - res.couts_eur,
         round((res.cash_eur - res.cotisations_eur - res.couts_eur) * (res.partage ->> 'jay')::numeric, 2),
         round((res.cash_eur - res.cotisations_eur - res.couts_eur) * (res.partage ->> 'junior')::numeric, 2)
    from res
   where public.lecture_autorisee();
$$;

create or replace view public.v_partage with (security_invoker = true) as
  select * from public.partage_au(now());

-- ---------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------
-- anon ne voit rien
revoke all on all tables in schema public from anon;

-- Personnes connectées : lecture partout (filtrée par RLS), écriture seulement là où une règle existe
revoke all on public.profils, public.reglages, public.clients, public.abonnements, public.paiements,
              public.objectifs, public.couts, public.appels, public.actions, public.autonomie,
              public.messages, public.rapports, public.agents_etat, public.journal
  from authenticated;
grant select on public.profils, public.reglages, public.clients, public.abonnements, public.paiements,
                public.objectifs, public.couts, public.appels, public.actions, public.autonomie,
                public.messages, public.rapports, public.agents_etat, public.journal,
                public.promotion_possible, public.v_cash_mensuel, public.v_cash_resume, public.v_cash_attendu,
                public.v_cash_cumul, public.v_seuils, public.v_partage
  to authenticated;
grant insert, update, delete on public.clients, public.appels to authenticated;
grant insert on public.messages to authenticated;
grant insert, update on public.reglages, public.objectifs, public.couts to authenticated;

-- Clé secrète (n8n, serveur) : tout
grant all on public.profils, public.reglages, public.clients, public.abonnements, public.paiements,
             public.objectifs, public.couts, public.appels, public.actions, public.autonomie,
             public.messages, public.rapports, public.agents_etat, public.journal,
             public.promotion_possible, public.v_cash_mensuel, public.v_cash_resume, public.v_cash_attendu,
             public.v_cash_cumul, public.v_seuils, public.v_partage
  to service_role;

-- Fonctions : personne d'anonyme
revoke execute on function
  public.est_membre(), public.est_admin(), public.mon_marche(), public.lecture_autorisee(),
  public.touche_maj(), public.relier_client(), public.type_action_verrouille(text), public.actions_avant_ajout(),
  public.rattacher_historique_client(), public.clients_avant_ecriture(), public.messages_avant_ajout(),
  public.decider_action(uuid, boolean, text), public.changer_autonomie(text, text, int),
  public.taux_usd_eur(), public.devise_marche(text), public.convertir(numeric, text, text),
  public.montant_marche(numeric, numeric, text, text),
  public.cash_resume_au(timestamptz), public.cash_attendu_au(timestamptz),
  public.seuils_au(timestamptz), public.partage_au(timestamptz)
  from public, anon;
grant execute on function
  public.est_membre(), public.est_admin(), public.mon_marche(), public.lecture_autorisee(),
  public.type_action_verrouille(text),
  public.decider_action(uuid, boolean, text), public.changer_autonomie(text, text, int),
  public.taux_usd_eur(), public.devise_marche(text), public.convertir(numeric, text, text),
  public.montant_marche(numeric, numeric, text, text),
  public.cash_resume_au(timestamptz), public.cash_attendu_au(timestamptz),
  public.seuils_au(timestamptz), public.partage_au(timestamptz)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Temps réel (Supabase Realtime) sur les tables suivies par le cockpit
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    foreach t in array array['paiements', 'actions', 'messages', 'journal', 'agents_etat'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
