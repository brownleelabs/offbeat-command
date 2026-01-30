-- Add updated_at to tokens for zombie cleanup (stuck PENDING_SETTLEMENT older than 1 hour).
-- Prerequisite: public.tokens exists.

ALTER TABLE public.tokens ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
COMMENT ON COLUMN public.tokens.updated_at IS 'Last row update; used by zombie cleanup to find stuck PENDING_SETTLEMENT.';

UPDATE public.tokens SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tokens_updated_at ON public.tokens;
CREATE TRIGGER tokens_updated_at
  BEFORE UPDATE ON public.tokens
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_tokens_updated_at();
