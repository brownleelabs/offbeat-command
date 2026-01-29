-- Campaign audit log: every material action on a campaign is recorded for full auditability.
-- Supports compliance, "big picture" reporting for university stakeholders, and export-ready data collection.
-- Event types: created, launched, updated, archived, unarchived, deleted, restored, viewed, pinned, unpinned, exported (reserved).

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

-- No update/delete: append-only audit log.
grant select, insert on public.campaign_audit_log to authenticated;
