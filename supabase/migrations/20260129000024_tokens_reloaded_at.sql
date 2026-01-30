-- Tokens: reloaded_at for asset detail (when a redeemed token was put back to active).
-- Prerequisite: public.tokens exists.

alter table public.tokens add column if not exists reloaded_at timestamptz;
comment on column public.tokens.reloaded_at is 'When this token was last reloaded (status set from found to active); set on reload, kept for audit.';
