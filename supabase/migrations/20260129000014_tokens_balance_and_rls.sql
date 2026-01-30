-- Tokens: balance column (for transfer guard) and RLS (SUPER_ADMIN / org-scoped read).
-- Prerequisite: public.tokens and public.profiles exist; public.is_super_admin() exists.

-- Balance: block org transfer when any selected token has balance > 0 (invariant).
alter table public.tokens add column if not exists balance numeric not null default 0;
comment on column public.tokens.balance is 'Token balance; must be zero before transferring to another organization.';

-- RLS: no direct client writes; server/service role only for mutations. Read: SUPER_ADMIN all, ORG_ADMIN own org.
alter table public.tokens enable row level security;

drop policy if exists "SUPER_ADMIN can read all tokens" on public.tokens;
create policy "SUPER_ADMIN can read all tokens"
  on public.tokens for select to authenticated
  using (public.is_super_admin());

drop policy if exists "ORG_ADMIN can read own org tokens" on public.tokens;
create policy "ORG_ADMIN can read own org tokens"
  on public.tokens for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'ORG_ADMIN'
        and p.organization_id is not null
        and p.organization_id = tokens.organization_id
    )
  );

-- No insert/update/delete for authenticated; fleet mutations use service role or server-side client.
grant select on public.tokens to authenticated;
