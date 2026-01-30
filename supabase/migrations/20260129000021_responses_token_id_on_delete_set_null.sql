-- Allow deleting tokens that have been redeemed: keep response rows for audit but set token_id to null.
-- Drop existing FK (name may be responses_token_id_fkey) and re-add with ON DELETE SET NULL.

alter table public.responses
  drop constraint if exists responses_token_id_fkey;

alter table public.responses
  add constraint responses_token_id_fkey
  foreign key (token_id) references public.tokens(id) on delete set null;
