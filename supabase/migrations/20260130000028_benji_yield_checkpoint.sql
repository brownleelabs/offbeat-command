-- Store last checked BENJI yield amount for Rain Barrel cron (delta = currentEstAmount - last_checked).
-- Prerequisite: public.site_settings exists.

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS benji_last_checked_amount numeric DEFAULT 0;

COMMENT ON COLUMN public.site_settings.benji_last_checked_amount IS 'Last BENJI currentEstAmount used by yield-distribution cron to compute newYield delta.';
