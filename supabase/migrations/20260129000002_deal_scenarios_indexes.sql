-- Deal scenarios: indexes for stable pagination + filtering + search.
-- These are safe to run repeatedly.

create extension if not exists pg_trgm;

-- Stable ordering for keyset/range pagination
create index if not exists idx_deal_scenarios_created_id_desc
  on public.deal_scenarios (created_at desc, id desc);

-- Default list view (hide archived/deleted by default)
create index if not exists idx_deal_scenarios_active_created_id_desc
  on public.deal_scenarios (created_at desc, id desc)
  where deleted_at is null and archived_at is null;

-- Group version lookup (latest version per group)
create index if not exists idx_deal_scenarios_group_version_desc
  on public.deal_scenarios (scenario_group_id, version desc)
  where scenario_group_id is not null;

-- Pinned-first ordering (Deal Desk)
create index if not exists idx_deal_scenarios_pinned_created_id_desc
  on public.deal_scenarios (pinned desc, pinned_at desc nulls last, created_at desc, id desc);

-- Search helpers for ILIKE filters
create index if not exists idx_deal_scenarios_name_trgm
  on public.deal_scenarios using gin (name gin_trgm_ops);

create index if not exists idx_deal_scenarios_university_name_trgm
  on public.deal_scenarios using gin (university_name gin_trgm_ops);

-- Tighten versioning when data allows it.
-- If duplicates exist, we skip the unique index so the migration still succeeds.
do $$
begin
  if exists (
    select 1
    from public.deal_scenarios
    where scenario_group_id is not null and version is not null
    group by scenario_group_id, version
    having count(*) > 1
    limit 1
  ) then
    raise notice 'Skipping unique index deal_scenarios_group_version_unique (duplicates exist).';
  else
    execute 'create unique index if not exists deal_scenarios_group_version_unique
             on public.deal_scenarios (scenario_group_id, version)
             where scenario_group_id is not null and version is not null';
  end if;
end $$;

