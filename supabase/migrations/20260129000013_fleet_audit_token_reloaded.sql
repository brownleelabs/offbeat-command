-- Add token_reloaded event type to fleet_audit_log (SUPER_ADMIN reloads $25 to redeemed tokens).
-- Constraint name may vary; drop by scanning pg_constraint.

do $$
begin
  alter table public.fleet_audit_log
    drop constraint if exists fleet_audit_log_event_type_check;
  alter table public.fleet_audit_log
    add constraint fleet_audit_log_event_type_check
    check (event_type in (
      'campaign_assigned', 'organization_assigned', 'urls_exported', 'token_created', 'token_reloaded'
    ));
exception
  when others then
    raise notice 'fleet_audit_log event_type constraint: %', sqlerrm;
end $$;
