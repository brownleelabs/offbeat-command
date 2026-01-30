-- Access requests: stored for audit; inserts via service role from server action.
-- RLS: no anon access; SUPER_ADMIN can read for future dashboard listing.

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text,
  created_at timestamptz not null default now()
);

alter table public.access_requests enable row level security;

-- No anon/authenticated insert: server action uses service role (bypasses RLS).
-- SUPER_ADMIN can read for future listing in Settings or dashboard.
drop policy if exists "SUPER_ADMIN can read access_requests" on public.access_requests;
create policy "SUPER_ADMIN can read access_requests"
  on public.access_requests
  for select
  to authenticated
  using (public.is_super_admin());

grant select on public.access_requests to authenticated;
