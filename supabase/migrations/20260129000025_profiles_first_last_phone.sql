-- Add first name, last name, and phone to profiles for Command Center identity and SuperAdmin/OrgAdmin access.
-- No sign-ups on landing page; only log in. Admins create users in Settings with name, email, phone, password.

alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists phone text;

comment on column public.profiles.first_name is 'User first name; shown in Command Center "You are" banner.';
comment on column public.profiles.last_name is 'User last name; shown in Command Center "You are" banner.';
comment on column public.profiles.phone is 'Phone number; required for SuperAdmin/OrgAdmin access (validated in app).';
