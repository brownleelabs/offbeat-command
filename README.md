# Campus Mobility Project Control Center

This is the Campus Mobility Project Control Center, built with the Next.js App Router and Supabase.

The root `/` route behaves as:

- **Unauthenticated visitors:** See a simple landing page with project overview, a **Sign in** button, and a **Request access** form.
- **Authenticated users:** See the admin dashboard (fleet, campaigns, map, settings).

## Getting Started

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in your browser.

## Environment variables

Create a `.env.local` file in the project root with at least:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Mapbox
NEXT_PUBLIC_MAPBOX_TOKEN=

# Request access form (landing page)
RESEND_API_KEY=
ACCESS_REQUEST_EMAIL=
# Optional: override default From address for Resend
RESEND_FROM=
```

- `RESEND_API_KEY` – API key from [Resend](https://resend.com/docs) (required for the Request access form to send email).
- `ACCESS_REQUEST_EMAIL` – email address where Request access submissions are sent.
- `RESEND_FROM` – optional from-address, e.g. `"Campus Mobility <no-reply@yourdomain.edu>"`. If omitted, a Resend default is used.

## Database: access_requests

The landing page **Request access** form:

- Inserts a row into the `public.access_requests` table (via a server action using the Supabase service role).
- Sends an email via Resend to `ACCESS_REQUEST_EMAIL` with the submitted details.

The migration for this table lives in:

- `supabase/migrations/20260129_000009_access_requests.sql`

