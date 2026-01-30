-- Tokens: audit timestamps for asset detail (when was the ID created, when was the URL last tapped/redeemed).
-- Prerequisite: public.tokens exists.

alter table public.tokens add column if not exists created_at timestamptz default now();
comment on column public.tokens.created_at is 'When the token/asset ID was created (audit).';

alter table public.tokens add column if not exists redeemed_at timestamptz;
comment on column public.tokens.redeemed_at is 'When the claim URL was last tapped (claim submitted); set on redeem, cleared on reload (audit).';
