-- =============================================================================
-- Paste this into Supabase Dashboard → SQL Editor and run.
-- Use this if you already have tokens + responses + fleet_audit_log.
-- Adds: token audit timestamps (created_at, redeemed_at) + ORG_ADMIN can read responses for Fleet "Redeemed by".
-- =============================================================================

-- 1. Tokens: audit timestamps (when ID created, when URL last tapped/redeemed)
alter table public.tokens add column if not exists created_at timestamptz default now();
comment on column public.tokens.created_at is 'When the token/asset ID was created (audit).';

alter table public.tokens add column if not exists redeemed_at timestamptz;
comment on column public.tokens.redeemed_at is 'When the claim URL was last tapped (claim submitted); set on redeem, cleared on reload (audit).';

-- 2. Responses: ORG_ADMIN can read their org's responses (Fleet asset detail: show who redeemed)
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
