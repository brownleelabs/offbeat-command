-- Add token_deleted and token_funded event types to fleet_audit_log.
-- Constraint name may vary; drop by name then re-add.

do $$
begin
  alter table public.fleet_audit_log
    drop constraint if exists fleet_audit_log_event_type_check;
  alter table public.fleet_audit_log
    add constraint fleet_audit_log_event_type_check
    check (event_type in (
      'campaign_assigned', 'organization_assigned', 'urls_exported', 'token_created', 'token_reloaded',
      'token_deleted', 'token_funded'
    ));
exception
  when others then
    raise notice 'fleet_audit_log event_type constraint: %', sqlerrm;
end $$;
