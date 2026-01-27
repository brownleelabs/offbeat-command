# Organizations table setup (Supabase)

The Command Center expects an `organizations` table. Fleet "Assign to organization" and Campaigns "Create Campaign" only list **schools** (rows with `type = 'school'`).

## 1. Create the table (if it doesn't exist)

In Supabase **SQL Editor**, run:

```sql
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  type text not null default 'school' check (type in ('school', 'institution'))
);

-- Optional: unique slug for public /schools/[slug] URLs
create unique index if not exists organizations_slug_key on public.organizations (slug) where slug is not null;
```

## 2. Row Level Security (RLS)

Allow authenticated users to read organizations (needed for dashboard dropdowns and schools page):

```sql
alter table public.organizations enable row level security;

-- Allow read for authenticated users
create policy "Authenticated users can read organizations"
  on public.organizations for select
  to authenticated
  using (true);
```

Adjust the policy if your app uses different roles or anon access for the public schools page.

## 3. Insert at least one school

```sql
insert into public.organizations (name, slug, type)
values ('Example University', 'example-university', 'school');
```

After this, the Fleet and Campaigns tabs should show organizations in the dropdowns. The dashboard only displays rows where `type = 'school'`; use `type = 'institution'` for non‑school orgs you don’t want in those dropdowns.
