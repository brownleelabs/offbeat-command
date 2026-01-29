-- Campaigns: SUPER_ADMIN-only access via RLS.
-- Uses public.is_super_admin() (defined in deal_scenarios RLS migration).

alter table public.campaigns enable row level security;

drop policy if exists "SUPER_ADMIN can read campaigns" on public.campaigns;
drop policy if exists "SUPER_ADMIN can insert campaigns" on public.campaigns;
drop policy if exists "SUPER_ADMIN can update campaigns" on public.campaigns;
drop policy if exists "SUPER_ADMIN can delete campaigns" on public.campaigns;

create policy "SUPER_ADMIN can read campaigns"
  on public.campaigns
  for select
  to authenticated
  using (public.is_super_admin());

create policy "SUPER_ADMIN can insert campaigns"
  on public.campaigns
  for insert
  to authenticated
  with check (public.is_super_admin());

create policy "SUPER_ADMIN can update campaigns"
  on public.campaigns
  for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "SUPER_ADMIN can delete campaigns"
  on public.campaigns
  for delete
  to authenticated
  using (public.is_super_admin());

grant select, insert, update, delete on public.campaigns to authenticated;
