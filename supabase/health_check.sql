-- =============================================================================
-- SYNC CHECK — Run in Supabase Dashboard SQL Editor. Look at the FIRST result.
-- One row: "IN SYNC" or "NOT IN SYNC" + what to do.
-- =============================================================================

with expected_tables (table_name) as (
  values
    ('deal_scenarios'),('campaigns'),('campaign_audit_log'),('responses'),
    ('fleet_audit_log'),('access_requests'),('tokens'),('profiles')
),
expected_policies (tablename, policyname) as (
  values
    ('access_requests', 'SUPER_ADMIN can read access_requests'),
    ('campaign_audit_log', 'SUPER_ADMIN can read campaign_audit_log'),
    ('campaign_audit_log', 'SUPER_ADMIN can insert campaign_audit_log'),
    ('campaigns', 'SUPER_ADMIN can read campaigns'),
    ('campaigns', 'SUPER_ADMIN can insert campaigns'),
    ('campaigns', 'SUPER_ADMIN can update campaigns'),
    ('campaigns', 'SUPER_ADMIN can delete campaigns'),
    ('deal_scenarios', 'SUPER_ADMIN can read deal_scenarios'),
    ('deal_scenarios', 'SUPER_ADMIN can insert deal_scenarios'),
    ('deal_scenarios', 'SUPER_ADMIN can update deal_scenarios'),
    ('deal_scenarios', 'SUPER_ADMIN can delete deal_scenarios'),
    ('fleet_audit_log', 'SUPER_ADMIN can read fleet_audit_log'),
    ('fleet_audit_log', 'SUPER_ADMIN can insert fleet_audit_log'),
    ('fleet_audit_log', 'ORG_ADMIN can insert fleet_audit_log'),
    ('responses', 'SUPER_ADMIN can read responses'),
    ('responses', 'SUPER_ADMIN can insert responses'),
    ('responses', 'ORG_ADMIN can read own org responses'),
    ('tokens', 'SUPER_ADMIN can read all tokens'),
    ('tokens', 'ORG_ADMIN can read own org tokens')
),
actual_tables as (
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
),
actual_policies as (
  select tablename, policyname from pg_policies where schemaname = 'public'
),
missing_t as (
  select e.table_name from expected_tables e
  left join actual_tables a on a.table_name = e.table_name where a.table_name is null
),
missing_p as (
  select e.tablename, e.policyname from expected_policies e
  left join actual_policies a on a.tablename = e.tablename and a.policyname = e.policyname
  where a.policyname is null
)
select
  case when (select count(*) from missing_t) = 0 and (select count(*) from missing_p) = 0
    then 'IN SYNC'
    else 'NOT IN SYNC'
  end as "Status",
  coalesce((select string_agg(table_name, ', ') from missing_t), 'None') as "Missing tables",
  coalesce((select string_agg(tablename || ': ' || policyname, '; ') from missing_p), 'None') as "Missing policies",
  case
    when (select count(*) from missing_t) > 0 then 'Create missing tables (see migrations), then run sync_fix.sql'
    when (select count(*) from missing_p) > 0 then 'Run sync_fix.sql in SQL Editor, then run this again'
    else 'Nothing. You are done.'
  end as "What to do";
