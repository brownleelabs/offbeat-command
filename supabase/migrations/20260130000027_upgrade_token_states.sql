-- Upgrade tokens to 6-state model: MINTED, DORMANT, ACTIVE, PENDING_SETTLEMENT, REDEEMED, VOID.
-- Adds nfc_uid, asset_uuid, yield_source_id; redemption_history for Burn rule; active_requires_tether.
-- Prerequisite: public.tokens exists with status text ('active'|'found').
-- Idempotent: safe to re-run (CREATE TYPE only if not exists; ADD COLUMN IF NOT EXISTS, etc.).

-- 1. Create enum for 6 operational states (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'token_state') THEN
    CREATE TYPE token_state AS ENUM (
      'MINTED',             -- Digital value from yield (Ghost)
      'DORMANT',            -- Physical chip deployed but empty (Shell)
      'ACTIVE',             -- Asset ID assigned to physical ID (Live)
      'PENDING_SETTLEMENT', -- Student tapped, Venmo processing (Locked)
      'REDEEMED',           -- Payout complete, asset consumed (Spent)
      'VOID'                -- Stolen/Lost hardware (Kill Switch)
    );
  END IF;
END $$;

-- 2. Add new columns to tokens (nullable)
ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS nfc_uid text,
  ADD COLUMN IF NOT EXISTS asset_uuid uuid,
  ADD COLUMN IF NOT EXISTS yield_source_id text;

COMMENT ON COLUMN public.tokens.nfc_uid IS 'Immutable hardware ID from NTAG 424 DNA.';
COMMENT ON COLUMN public.tokens.asset_uuid IS 'Transient financial ID ($25 value); required when status = ACTIVE.';
COMMENT ON COLUMN public.tokens.yield_source_id IS 'Optional reference to BENJI transaction that minted this asset.';

-- 3. Data migration: add temp column, backfill, drop old status, rename
ALTER TABLE public.tokens ADD COLUMN IF NOT EXISTS status_new token_state;

UPDATE public.tokens
SET status_new = CASE
  WHEN status::text = 'found' THEN 'REDEEMED'::token_state
  ELSE 'DORMANT'::token_state
END
WHERE status_new IS NULL;

ALTER TABLE public.tokens DROP COLUMN IF EXISTS status;
ALTER TABLE public.tokens RENAME COLUMN status_new TO status;
ALTER TABLE public.tokens ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.tokens ALTER COLUMN status SET DEFAULT 'DORMANT';

-- 4. Redemption history (Burn rule: archive asset_uuid when token becomes REDEEMED)
CREATE TABLE IF NOT EXISTS public.redemption_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL,
  asset_uuid uuid NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  response_id uuid
);

COMMENT ON TABLE public.redemption_history IS 'Burn rule: archived asset_uuid per redemption for audit.';

CREATE INDEX IF NOT EXISTS idx_redemption_history_token_id ON public.redemption_history (token_id);
CREATE INDEX IF NOT EXISTS idx_redemption_history_redeemed_at ON public.redemption_history (redeemed_at DESC);

ALTER TABLE public.redemption_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SUPER_ADMIN can read redemption_history" ON public.redemption_history;
CREATE POLICY "SUPER_ADMIN can read redemption_history"
  ON public.redemption_history FOR SELECT TO authenticated
  USING (public.is_super_admin());

GRANT SELECT ON public.redemption_history TO authenticated;
-- Inserts only via service role (payout action).

-- 5. Constraint: ACTIVE tokens must have both nfc_uid and asset_uuid
ALTER TABLE public.tokens
  DROP CONSTRAINT IF EXISTS active_requires_tether;
ALTER TABLE public.tokens
  ADD CONSTRAINT active_requires_tether
  CHECK (status <> 'ACTIVE' OR (nfc_uid IS NOT NULL AND asset_uuid IS NOT NULL));

-- 6. Indexes for Rain Barrel and list/filter
CREATE INDEX IF NOT EXISTS idx_tokens_status ON public.tokens (status);
CREATE INDEX IF NOT EXISTS idx_tokens_asset_uuid ON public.tokens (asset_uuid) WHERE asset_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tokens_nfc_uid ON public.tokens (nfc_uid) WHERE nfc_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tokens_status_dormant ON public.tokens (id) WHERE status = 'DORMANT';

-- 7. Extend fleet_audit_log event_type for future token_minted / token_voided
DO $$
BEGIN
  ALTER TABLE public.fleet_audit_log DROP CONSTRAINT IF EXISTS fleet_audit_log_event_type_check;
  ALTER TABLE public.fleet_audit_log
    ADD CONSTRAINT fleet_audit_log_event_type_check
    CHECK (event_type IN (
      'campaign_assigned', 'organization_assigned', 'urls_exported', 'token_created', 'token_reloaded',
      'token_deleted', 'token_funded', 'tokens_funded_bulk', 'funds_removed',
      'token_minted', 'token_voided'
    ));
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'fleet_audit_log event_type: %', sqlerrm;
END $$;
