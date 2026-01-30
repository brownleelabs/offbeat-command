-- =============================================================================
-- FIX SYNC — Run this in Supabase Dashboard SQL Editor when health_check says NOT IN SYNC.
-- Then run health_check.sql again. Should say IN SYNC.
-- =============================================================================

-- 1. Drop legacy/extra policies (keeps profiles policies)
drop policy if exists "Unified Read Access for Campaigns" on public.campaigns;
drop policy if exists "Unified Write Access for Campaigns" on public.campaigns;
drop policy if exists "Super Admins can manage deals" on public.deal_scenarios;
drop policy if exists "Auditor Read All" on public.tokens;
drop policy if exists "Org Admin View" on public.tokens;
drop policy if exists "Super Admin Access" on public.tokens;
drop policy if exists "Unified Read Access" on public.tokens;
drop policy if exists "Unified Write Access" on public.tokens;

-- 2. Add missing deal_scenarios policies (from 20260129000003_deal_scenarios_rls.sql)
drop policy if exists "SUPER_ADMIN can read deal_scenarios" on public.deal_scenarios;
drop policy if exists "SUPER_ADMIN can insert deal_scenarios" on public.deal_scenarios;
drop policy if exists "SUPER_ADMIN can update deal_scenarios" on public.deal_scenarios;
drop policy if exists "SUPER_ADMIN can delete deal_scenarios" on public.deal_scenarios;

create policy "SUPER_ADMIN can read deal_scenarios"
  on public.deal_scenarios for select to authenticated
  using (public.is_super_admin());

create policy "SUPER_ADMIN can insert deal_scenarios"
  on public.deal_scenarios for insert to authenticated
  with check (public.is_super_admin());

create policy "SUPER_ADMIN can update deal_scenarios"
  on public.deal_scenarios for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "SUPER_ADMIN can delete deal_scenarios"
  on public.deal_scenarios for delete to authenticated
  using (public.is_super_admin());
