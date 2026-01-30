-- Allow ORG_ADMIN to read responses for their organization (Fleet asset detail: show who redeemed).
-- Prerequisite: public.responses and public.profiles exist.

drop policy if exists "ORG_ADMIN can read own org responses" on public.responses;
create policy "ORG_ADMIN can read own org responses"
  on public.responses for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'ORG_ADMIN'
        and p.organization_id is not null
        and p.organization_id = responses.organization_id
    )
  );
