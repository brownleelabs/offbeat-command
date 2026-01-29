-- Campaigns: indexes for pagination, filtering, and search.
-- Safe to run repeatedly.

create extension if not exists pg_trgm;

-- Stable ordering for list
create index if not exists idx_campaigns_created_id_desc
  on public.campaigns (created_at desc, id desc);

-- By organization
create index if not exists idx_campaigns_organization_created_desc
  on public.campaigns (organization_id, created_at desc)
  where organization_id is not null;

-- Default list (active: not archived, not deleted)
create index if not exists idx_campaigns_active_created_id_desc
  on public.campaigns (created_at desc, id desc)
  where deleted_at is null and archived_at is null;

-- Pinned-first ordering (match deal desk)
create index if not exists idx_campaigns_pinned_created_id_desc
  on public.campaigns (pinned desc, pinned_at desc nulls last, created_at desc, id desc);

-- Search by name (ILIKE)
create index if not exists idx_campaigns_name_trgm
  on public.campaigns using gin (name gin_trgm_ops);
