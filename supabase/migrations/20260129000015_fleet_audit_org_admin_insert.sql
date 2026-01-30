-- Allow ORG_ADMIN to insert into fleet_audit_log so org-scoped actions are persisted (not just console).
-- Prerequisite: public.fleet_audit_log and public.profiles exist.

drop policy if exists "ORG_ADMIN can insert fleet_audit_log" on public.fleet_audit_log;
create policy "ORG_ADMIN can insert fleet_audit_log"
  on public.fleet_audit_log for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'ORG_ADMIN'
    )
  );
