-- One-time: remove duplicate responses per token_id, keeping the earliest created_at.
-- Run this only if uidx_responses_token_id_unique was skipped due to duplicates.
-- After this, run: create unique index if not exists uidx_responses_token_id_unique on public.responses (token_id) where token_id is not null;

-- Preview: rows that will be deleted (all but the earliest response per token_id)
-- Uncomment to run before the delete:
/*
SELECT id, token_id, created_at,
       row_number() OVER (PARTITION BY token_id ORDER BY created_at) AS rn
FROM public.responses
WHERE token_id IS NOT NULL
ORDER BY token_id, created_at;
*/

-- Delete duplicates: keep one row per token_id (earliest created_at), remove the rest
DELETE FROM public.responses
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (PARTITION BY token_id ORDER BY created_at) AS rn
    FROM public.responses
    WHERE token_id IS NOT NULL
  ) sub
  WHERE rn > 1
);

-- Now safe to add the unique index (run if not already created by migration)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_responses_token_id_unique
  ON public.responses (token_id)
  WHERE token_id IS NOT NULL;
