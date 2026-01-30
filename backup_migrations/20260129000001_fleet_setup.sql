-- =============================================================================
-- Fleet: Run in Supabase Dashboard → SQL Editor (one-time or after schema reset).
-- Prerequisites: public.profiles (id, role, organization_id), public.campaigns,
--   public.organizations. Optionally run RUN_ALL_CAMPAIGNS_AND_AUDIT.sql first.
-- =============================================================================

-- 0. Helper: is_super_admin() [required by Fleet RLS]
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'SUPER_ADMIN'
  );
$$;

-- 1. Tokens table (if not already created elsewhere; no FK so this runs without organizations/campaigns)
create table if not exists public.tokens (
  id uuid primary key,
  lat numeric not null default 0,
  lng numeric not null default 0,
  status text not null default 'active' check (status in ('active', 'found')),
  organization_id uuid,
  campaign_id uuid,
  created_at timestamptz default now(),
  redeemed_at timestamptz
);

alter table public.tokens add column if not exists balance numeric not null default 0;
alter table public.tokens add column if not exists created_at timestamptz default now();
alter table public.tokens add column if not exists redeemed_at timestamptz;

-- 2. Fleet audit log
create table if not exists public.fleet_audit_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'campaign_assigned', 'organization_assigned', 'urls_exported', 'token_created', 'token_reloaded'
  )),
  actor_user_id uuid,
  at timestamptz not null default now(),
  payload jsonb
);

comment on table public.fleet_audit_log is 'Audit trail for fleet/token operations.';

create index if not exists idx_fleet_audit_log_at on public.fleet_audit_log (at desc);
create index if not exists idx_fleet_audit_log_actor_at on public.fleet_audit_log (actor_user_id, at desc) where actor_user_id is not null;

alter table public.fleet_audit_log enable row level security;

drop policy if exists "SUPER_ADMIN can read fleet_audit_log" on public.fleet_audit_log;
drop policy if exists "SUPER_ADMIN can insert fleet_audit_log" on public.fleet_audit_log;
create policy "SUPER_ADMIN can read fleet_audit_log" on public.fleet_audit_log for select to authenticated using (public.is_super_admin());
create policy "SUPER_ADMIN can insert fleet_audit_log" on public.fleet_audit_log for insert to authenticated with check (public.is_super_admin());

drop policy if exists "ORG_ADMIN can insert fleet_audit_log" on public.fleet_audit_log;
create policy "ORG_ADMIN can insert fleet_audit_log" on public.fleet_audit_log for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ORG_ADMIN'));

grant select, insert on public.fleet_audit_log to authenticated;

-- 3. Token indexes (list + scale)
create index if not exists idx_tokens_organization_id on public.tokens (organization_id) where organization_id is not null;
create index if not exists idx_tokens_campaign_id on public.tokens (campaign_id) where campaign_id is not null;
create index if not exists idx_tokens_status on public.tokens (status);
create index if not exists idx_tokens_org_campaign_status on public.tokens (organization_id, campaign_id, status);

create index if not exists idx_tokens_list_org_campaign_status_id on public.tokens (organization_id, campaign_id, status, id) where organization_id is not null;
create index if not exists idx_tokens_list_global_campaign_status_id on public.tokens (campaign_id, status, id);
create index if not exists idx_tokens_list_unassigned_id on public.tokens (id) where organization_id is null;

-- 4. Tokens RLS
alter table public.tokens enable row level security;

drop policy if exists "SUPER_ADMIN can read all tokens" on public.tokens;
create policy "SUPER_ADMIN can read all tokens" on public.tokens for select to authenticated using (public.is_super_admin());

drop policy if exists "ORG_ADMIN can read own org tokens" on public.tokens;
create policy "ORG_ADMIN can read own org tokens" on public.tokens for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'ORG_ADMIN' and p.organization_id is not null and p.organization_id = tokens.organization_id
    )
  );

grant select on public.tokens to authenticated;

-- 5. RPC: token counts per campaign (Fleet + Campaigns tabs)
create or replace function public.get_token_counts_by_campaigns(p_campaign_ids uuid[])
returns table(campaign_id uuid, token_count bigint)
language sql stable security invoker set search_path = public
as $$
  select t.campaign_id, count(*)::bigint from public.tokens t where t.campaign_id = any(p_campaign_ids) group by t.campaign_id
$$;

grant execute on function public.get_token_counts_by_campaigns(uuid[]) to authenticated;
