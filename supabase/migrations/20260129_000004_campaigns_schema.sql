-- Campaigns: create table + add governance/state columns (match deal desk).
-- Idempotent: safe for existing projects that already have campaigns table.

create extension if not exists pgcrypto;

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Core fields (add if not exists for existing table)
alter table public.campaigns add column if not exists name text;
alter table public.campaigns add column if not exists organization_id uuid;
alter table public.campaigns add column if not exists required_fields jsonb;
alter table public.campaigns add column if not exists questions jsonb;

-- Governance / state (mirror deal desk)
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

-- Defaults (safe to re-run)
alter table public.campaigns alter column pinned set default false;

-- Backfill status only where missing (idempotent: re-run won't overwrite draft/active/inactive)
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

-- Optional foreign keys (only if missing)
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
