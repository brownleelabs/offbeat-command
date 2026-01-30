-- Tokens: indexes for 500k-scale Fleet list (paginated list + count) and map.
-- Prerequisite: public.tokens exists.
-- listTokens: filter by organization_id (optional), campaign_id (optional), status (optional); order by id; range(from, to); count exact.
-- listTokensForMap: filter by organization_id (optional); order by id; limit 500.

-- Org-scoped list (ORG_ADMIN, SUPER_ADMIN in TENANT mode): filter + order by id + range/count.
-- Planner can use this for both the paginated SELECT and the count with same filters.
create index if not exists idx_tokens_list_org_campaign_status_id
  on public.tokens (organization_id, campaign_id, status, id)
  where organization_id is not null;

-- Global list (SUPER_ADMIN GLOBAL, no org filter): optional campaign_id, status; order by id.
create index if not exists idx_tokens_list_global_campaign_status_id
  on public.tokens (campaign_id, status, id);

-- Unassigned tokens (organization_id is null) list: order by id for consistency.
create index if not exists idx_tokens_list_unassigned_id
  on public.tokens (id)
  where organization_id is null;

comment on index public.idx_tokens_list_org_campaign_status_id is 'Fleet list/count at scale: org-scoped filter + order by id (500k tokens).';
comment on index public.idx_tokens_list_global_campaign_status_id is 'Fleet list/count at scale: global filter by campaign/status + order by id.';
comment on index public.idx_tokens_list_unassigned_id is 'Fleet list: unassigned tokens by id.';
