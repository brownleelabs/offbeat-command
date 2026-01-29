-- =============================================================================
-- Supabase: Campaigns + Audit Log + Responses (all-in-one)
-- Run this in Supabase Dashboard → SQL Editor (or via CLI).
-- Prerequisite: public.profiles must exist with columns id (uuid), role (text).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helper: is_super_admin() [required by campaigns, campaign_audit_log, responses RLS]
-- -----------------------------------------------------------------------------
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'SUPER_ADMIN'
  );
$$;

-- -----------------------------------------------------------------------------
-- 2. Campaigns table + columns
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto;

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.campaigns add column if not exists name text;
alter table public.campaigns add column if not exists organization_id uuid;
alter table public.campaigns add column if not exists required_fields jsonb;
alter table public.campaigns add column if not exists questions jsonb;
alter table public.campaigns add column if not exists status text default 'draft' check (status in ('draft', 'active', 'inactive'));
alter table public.campaigns add column if not exists launched_at timestamptz;
alter table public.campaigns add column if not exists archived_at timestamptz;
alter table public.campaigns add column if not exists archived_by uuid;
alter table public.campaigns add column if not exists deleted_at timestamptz;
alter table public.campaigns add column if not exists deleted_by uuid;
alter table public.campaigns add column if not exists owner_user_id uuid;
alter table public.campaigns add column if not exists last_viewed_at timestamptz;
alter table public.campaigns add column if not exists pinned boolean default false;
alter table public.campaigns add column if not exists pinned_at timestamptz;
alter table public.campaigns add column if not exists pinned_by uuid;

alter table public.campaigns alter column pinned set default false;

do $$
begin
  update public.campaigns
  set status = case
    when deleted_at is not null then 'inactive'
    when archived_at is not null then 'inactive'
    else 'active'
  end
  where status is null or status = '';
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_owner_user_id_fkey') then
    alter table public.campaigns
      add constraint campaigns_owner_user_id_fkey
      foreign key (owner_user_id) references auth.users(id) on delete set null;
  end if;
exception when undefined_table then
  raise notice 'Skipping auth.users FK (auth.users not found).';
end $$;

-- -----------------------------------------------------------------------------
-- 3. Campaigns indexes
-- -----------------------------------------------------------------------------
create extension if not exists pg_trgm;

create index if not exists idx_campaigns_created_id_desc
  on public.campaigns (created_at desc, id desc);

create index if not exists idx_campaigns_organization_created_desc
  on public.campaigns (organization_id, created_at desc)
  where organization_id is not null;

create index if not exists idx_campaigns_active_created_id_desc
  on public.campaigns (created_at desc, id desc)
  where deleted_at is null and archived_at is null;

create index if not exists idx_campaigns_pinned_created_id_desc
  on public.campaigns (pinned desc, pinned_at desc nulls last, created_at desc, id desc);

create index if not exists idx_campaigns_name_trgm
  on public.campaigns using gin (name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 4. Campaigns RLS
-- -----------------------------------------------------------------------------
alter table public.campaigns enable row level security;

drop policy if exists "SUPER_ADMIN can read campaigns" on public.campaigns;
drop policy if exists "SUPER_ADMIN can insert campaigns" on public.campaigns;
drop policy if exists "SUPER_ADMIN can update campaigns" on public.campaigns;
drop policy if exists "SUPER_ADMIN can delete campaigns" on public.campaigns;

create policy "SUPER_ADMIN can read campaigns"
  on public.campaigns for select to authenticated
  using (public.is_super_admin());

create policy "SUPER_ADMIN can insert campaigns"
  on public.campaigns for insert to authenticated
  with check (public.is_super_admin());

create policy "SUPER_ADMIN can update campaigns"
  on public.campaigns for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "SUPER_ADMIN can delete campaigns"
  on public.campaigns for delete to authenticated
  using (public.is_super_admin());

grant select, insert, update, delete on public.campaigns to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Campaign audit log
-- -----------------------------------------------------------------------------
create table if not exists public.campaign_audit_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  event_type text not null check (event_type in (
    'created', 'launched', 'updated', 'archived', 'unarchived', 'deleted', 'restored',
    'viewed', 'pinned', 'unpinned', 'exported'
  )),
  actor_user_id uuid,
  at timestamptz not null default now(),
  payload jsonb
);

comment on table public.campaign_audit_log is 'Audit trail for campaign lifecycle and interactions; supports fully auditable data collection and reporting.';

create index if not exists idx_campaign_audit_log_campaign_at
  on public.campaign_audit_log (campaign_id, at desc);

create index if not exists idx_campaign_audit_log_actor_at
  on public.campaign_audit_log (actor_user_id, at desc)
  where actor_user_id is not null;

create index if not exists idx_campaign_audit_log_at
  on public.campaign_audit_log (at desc);

alter table public.campaign_audit_log enable row level security;

drop policy if exists "SUPER_ADMIN can read campaign_audit_log" on public.campaign_audit_log;
drop policy if exists "SUPER_ADMIN can insert campaign_audit_log" on public.campaign_audit_log;

create policy "SUPER_ADMIN can read campaign_audit_log"
  on public.campaign_audit_log for select to authenticated
  using (public.is_super_admin());

create policy "SUPER_ADMIN can insert campaign_audit_log"
  on public.campaign_audit_log for insert to authenticated
  with check (public.is_super_admin());

grant select, insert on public.campaign_audit_log to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Responses table + columns + indexes + RLS
-- -----------------------------------------------------------------------------
create table if not exists public.responses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.responses add column if not exists campaign_id uuid;
alter table public.responses add column if not exists token_id uuid;
alter table public.responses add column if not exists organization_id uuid;
alter table public.responses add column if not exists first_name text;
alter table public.responses add column if not exists last_name text;
alter table public.responses add column if not exists student_id text;
alter table public.responses add column if not exists student_email text;
alter table public.responses add column if not exists venmo_username text;
alter table public.responses add column if not exists custom_answers jsonb;
alter table public.responses add column if not exists claim_metadata jsonb;

comment on table public.responses is 'Campaign claim submissions; immutable chain of record for KYC, payout verification, and data collection audit.';

create index if not exists idx_responses_campaign_id on public.responses (campaign_id);
create index if not exists idx_responses_token_id on public.responses (token_id);
create index if not exists idx_responses_organization_id on public.responses (organization_id);
create index if not exists idx_responses_created_at on public.responses (created_at desc);

create unique index if not exists uidx_responses_token_id_unique
  on public.responses (token_id)
  where token_id is not null;

alter table public.responses enable row level security;

drop policy if exists "SUPER_ADMIN can read responses" on public.responses;
drop policy if exists "SUPER_ADMIN can insert responses" on public.responses;

create policy "SUPER_ADMIN can read responses"
  on public.responses for select to authenticated
  using (public.is_super_admin());

create policy "SUPER_ADMIN can insert responses"
  on public.responses for insert to authenticated
  with check (public.is_super_admin());

grant select, insert on public.responses to authenticated;
