-- Responses: explicit schema for campaign claim submissions (auditable data collection).
-- Idempotent: create if not exists; add columns if table exists.
-- Chain of record: each row is immutable; links campaign_id + token_id + KYC + claim_metadata for audit.

create table if not exists public.responses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.responses add column if not exists campaign_id uuid;
alter table public.responses add column if not exists token_id uuid;
alter table public.responses add column if not exists organization_id uuid;
alter table public.responses add column if not exists first_name text;
alter table public.responses add column if not exists last_name text;
alter table public.responses add column if not exists student_id text;
alter table public.responses add column if not exists student_email text;
alter table public.responses add column if not exists venmo_username text;
alter table public.responses add column if not exists custom_answers jsonb;
alter table public.responses add column if not exists claim_metadata jsonb;

comment on table public.responses is 'Campaign claim submissions; immutable chain of record for KYC, payout verification, and data collection audit.';

-- Indexes for reporting, export, and ledger queries
create index if not exists idx_responses_campaign_id on public.responses (campaign_id);
create index if not exists idx_responses_token_id on public.responses (token_id);
create index if not exists idx_responses_organization_id on public.responses (organization_id);
create index if not exists idx_responses_created_at on public.responses (created_at desc);

-- Data integrity: prevent duplicate submissions for the same token
create unique index if not exists uidx_responses_token_id_unique
  on public.responses (token_id)
  where token_id is not null;

-- RLS: SUPER_ADMIN only for now; later add org-scoped select for college staff
alter table public.responses enable row level security;

drop policy if exists "SUPER_ADMIN can read responses" on public.responses;
drop policy if exists "SUPER_ADMIN can insert responses" on public.responses;

create policy "SUPER_ADMIN can read responses"
  on public.responses for select to authenticated
  using (public.is_super_admin());

create policy "SUPER_ADMIN can insert responses"
  on public.responses for insert to authenticated
  with check (public.is_super_admin());

-- Responses are immutable: no update/delete policies for authenticated; submitClaim uses service role.
grant select, insert on public.responses to authenticated;
