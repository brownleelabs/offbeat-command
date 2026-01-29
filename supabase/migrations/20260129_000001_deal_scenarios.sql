-- Deal scenarios: create table + add missing columns safely.
-- This migration is designed to be idempotent for existing Supabase projects.

create extension if not exists pgcrypto;

create table if not exists public.deal_scenarios (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Core fields
alter table public.deal_scenarios add column if not exists name text;
alter table public.deal_scenarios add column if not exists university_name text;

-- University context
alter table public.deal_scenarios add column if not exists endowment_size numeric;
alter table public.deal_scenarios add column if not exists student_enrollment numeric;

-- Deal inputs
alter table public.deal_scenarios add column if not exists target_students numeric;
alter table public.deal_scenarios add column if not exists target_reach_percent numeric;
alter table public.deal_scenarios add column if not exists redemption_velocity numeric;
alter table public.deal_scenarios add column if not exists interest_rate numeric;
alter table public.deal_scenarios add column if not exists assumed_yield_rate numeric;

-- Deal outputs / snapshots
alter table public.deal_scenarios add column if not exists calculated_tdv numeric;
alter table public.deal_scenarios add column if not exists tdv_amount numeric;
alter table public.deal_scenarios add column if not exists upfront_fee numeric;
alter table public.deal_scenarios add column if not exists projected_arr numeric;
alter table public.deal_scenarios add column if not exists annual_student_welfare numeric;
alter table public.deal_scenarios add column if not exists annual_operator_revenue numeric;
alter table public.deal_scenarios add column if not exists annual_principal_protection numeric;
alter table public.deal_scenarios add column if not exists allocation_percent numeric;

-- Versioning
alter table public.deal_scenarios add column if not exists scenario_group_id uuid;
alter table public.deal_scenarios add column if not exists version integer;

-- Scoring snapshots (immutable-at-save)
alter table public.deal_scenarios add column if not exists deal_score numeric;
alter table public.deal_scenarios add column if not exists deal_score_label text;
alter table public.deal_scenarios add column if not exists raw_economic_score numeric;
alter table public.deal_scenarios add column if not exists score_breakdown jsonb;
alter table public.deal_scenarios add column if not exists eps_at_save numeric;
alter table public.deal_scenarios add column if not exists allocation_at_save numeric;
alter table public.deal_scenarios add column if not exists fee_recoup_years_at_save numeric;

-- Yield/waterfall snapshots
alter table public.deal_scenarios add column if not exists k_eff_at_save numeric;
alter table public.deal_scenarios add column if not exists yield_environment text;
alter table public.deal_scenarios add column if not exists waterfall_shares jsonb;

-- Display / narrative
alter table public.deal_scenarios add column if not exists deal_zone text;
alter table public.deal_scenarios add column if not exists score_explanation text;
alter table public.deal_scenarios add column if not exists deal_summary text;

-- Metadata
alter table public.deal_scenarios add column if not exists tags text[];
alter table public.deal_scenarios add column if not exists notes text;
alter table public.deal_scenarios add column if not exists owner_user_id uuid;
alter table public.deal_scenarios add column if not exists last_viewed_at timestamptz;

-- Governance flags
alter table public.deal_scenarios add column if not exists pinned boolean;
alter table public.deal_scenarios add column if not exists pinned_at timestamptz;
alter table public.deal_scenarios add column if not exists pinned_by uuid;
alter table public.deal_scenarios add column if not exists archived_at timestamptz;
alter table public.deal_scenarios add column if not exists archived_by uuid;
alter table public.deal_scenarios add column if not exists deleted_at timestamptz;
alter table public.deal_scenarios add column if not exists deleted_by uuid;

-- Defaults (safe to re-run)
alter table public.deal_scenarios alter column pinned set default false;

-- Optional foreign keys (added only if missing)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'deal_scenarios_owner_user_id_fkey'
  ) then
    alter table public.deal_scenarios
      add constraint deal_scenarios_owner_user_id_fkey
      foreign key (owner_user_id) references auth.users(id) on delete set null;
  end if;
exception when undefined_table then
  -- In case auth schema isn't available in a local PG environment.
  raise notice 'Skipping auth.users FK creation (auth.users not found).';
end $$;

