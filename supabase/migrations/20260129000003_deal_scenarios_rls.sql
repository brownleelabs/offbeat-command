-- Deal scenarios: SUPER_ADMIN-only access via RLS.
-- Uses `public.profiles(role)` as the source of truth.
-- Prerequisite: public.profiles must exist with columns id (uuid, = auth.uid()) and role (text).

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'SUPER_ADMIN'
  );
$$;

alter table public.deal_scenarios enable row level security;

drop policy if exists "SUPER_ADMIN can read deal_scenarios" on public.deal_scenarios;
drop policy if exists "SUPER_ADMIN can insert deal_scenarios" on public.deal_scenarios;
drop policy if exists "SUPER_ADMIN can update deal_scenarios" on public.deal_scenarios;
drop policy if exists "SUPER_ADMIN can delete deal_scenarios" on public.deal_scenarios;

create policy "SUPER_ADMIN can read deal_scenarios"
  on public.deal_scenarios
  for select
  to authenticated
  using (public.is_super_admin());

create policy "SUPER_ADMIN can insert deal_scenarios"
  on public.deal_scenarios
  for insert
  to authenticated
  with check (public.is_super_admin());

create policy "SUPER_ADMIN can update deal_scenarios"
  on public.deal_scenarios
  for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "SUPER_ADMIN can delete deal_scenarios"
  on public.deal_scenarios
  for delete
  to authenticated
  using (public.is_super_admin());

-- Keep privileges explicit (RLS still applies).
grant select, insert, update, delete on public.deal_scenarios to authenticated;

