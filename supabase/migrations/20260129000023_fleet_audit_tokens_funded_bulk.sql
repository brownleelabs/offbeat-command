-- Add tokens_funded_bulk event type to fleet_audit_log (SuperAdmin bulk load funds to multiple tokens).

do $$
begin
  alter table public.fleet_audit_log
    drop constraint if exists fleet_audit_log_event_type_check;
  alter table public.fleet_audit_log
    add constraint fleet_audit_log_event_type_check
    check (event_type in (
      'campaign_assigned', 'organization_assigned', 'urls_exported', 'token_created', 'token_reloaded',
      'token_deleted', 'token_funded', 'tokens_funded_bulk', 'funds_removed'
    ));
exception
  when others then
    raise notice 'fleet_audit_log event_type constraint: %', sqlerrm;
end $$;
