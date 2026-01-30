-- Add institution to access_requests for role assignment.
alter table public.access_requests
  add column if not exists institution text;
