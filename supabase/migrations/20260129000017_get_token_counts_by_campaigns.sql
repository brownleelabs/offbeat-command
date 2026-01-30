-- RPC: token (asset) counts per campaign in one query. Used by Fleet and Campaigns tabs.
-- RLS on tokens applies (invoker); call via createServerSupabase() so counts match user scope.
-- Prerequisite: public.tokens exists.

create or replace function public.get_token_counts_by_campaigns(p_campaign_ids uuid[])
returns table(campaign_id uuid, token_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select t.campaign_id, count(*)::bigint
  from public.tokens t
  where t.campaign_id = any(p_campaign_ids)
  group by t.campaign_id
$$;

comment on function public.get_token_counts_by_campaigns(uuid[]) is 'Returns token count per campaign for given IDs; RLS applies so counts match user scope.';

grant execute on function public.get_token_counts_by_campaigns(uuid[]) to authenticated;
