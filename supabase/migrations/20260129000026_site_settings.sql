-- Site-wide settings (e.g. redemption success message). Single row; SUPER_ADMIN manages.
create table if not exists public.site_settings (
  id int primary key default 1 check (id = 1),
  redemption_success_note text,
  redemption_success_link text,
  updated_at timestamptz not null default now()
);

insert into public.site_settings (id, redemption_success_note, redemption_success_link, updated_at)
values (1, null, null, now())
on conflict (id) do nothing;

alter table public.site_settings enable row level security;

drop policy if exists "SUPER_ADMIN can select site_settings" on public.site_settings;
create policy "SUPER_ADMIN can select site_settings"
  on public.site_settings for select to authenticated
  using (public.is_super_admin());

drop policy if exists "SUPER_ADMIN can update site_settings" on public.site_settings;
create policy "SUPER_ADMIN can update site_settings"
  on public.site_settings for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

comment on table public.site_settings is 'Global site settings (redemption success message, etc.). Service role used for claim-page read.';
