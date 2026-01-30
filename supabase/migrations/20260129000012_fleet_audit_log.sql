-- Fleet/token audit log: every material fleet operation is recorded for auditability.
-- Event types: campaign_assigned, organization_assigned, urls_exported, token_created (reserved).
-- Prerequisite: public.is_super_admin() and public.tokens table must exist.

create table if not exists public.fleet_audit_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'campaign_assigned', 'organization_assigned', 'urls_exported', 'token_created', 'token_reloaded'
  )),
  actor_user_id uuid,
  at timestamptz not null default now(),
  payload jsonb
);

comment on table public.fleet_audit_log is 'Audit trail for fleet/token operations: assign campaign, assign org, export URLs, token creation.';

create index if not exists idx_fleet_audit_log_at
  on public.fleet_audit_log (at desc);

create index if not exists idx_fleet_audit_log_actor_at
  on public.fleet_audit_log (actor_user_id, at desc)
  where actor_user_id is not null;

alter table public.fleet_audit_log enable row level security;

drop policy if exists "SUPER_ADMIN can read fleet_audit_log" on public.fleet_audit_log;
drop policy if exists "SUPER_ADMIN can insert fleet_audit_log" on public.fleet_audit_log;

create policy "SUPER_ADMIN can read fleet_audit_log"
  on public.fleet_audit_log for select to authenticated
  using (public.is_super_admin());

create policy "SUPER_ADMIN can insert fleet_audit_log"
  on public.fleet_audit_log for insert to authenticated
  with check (public.is_super_admin());

grant select, insert on public.fleet_audit_log to authenticated;

-- Tokens list filters: ensure indexes exist for paginated list (organization_id, campaign_id, status).
create index if not exists idx_tokens_organization_id on public.tokens (organization_id)
  where organization_id is not null;
create index if not exists idx_tokens_campaign_id on public.tokens (campaign_id)
  where campaign_id is not null;
create index if not exists idx_tokens_status on public.tokens (status);
create index if not exists idx_tokens_org_campaign_status on public.tokens (organization_id, campaign_id, status);
