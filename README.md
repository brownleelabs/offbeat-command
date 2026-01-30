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

# Claim domain (used for claim URLs on NTAGs and in Fleet export)
# Set to your live domain, e.g. https://campusmobilityproject.com
# If unset, defaults to https://campusmobilityproject.com
# NEXT_PUBLIC_CLAIM_BASE_URL=https://campusmobilityproject.com

# Request access form (landing page)
RESEND_API_KEY=
ACCESS_REQUEST_EMAIL=
# Optional: override default From address for Resend
RESEND_FROM=
```

- `RESEND_API_KEY` – API key from [Resend](https://resend.com/docs) (required for the Request access form to send email).
- `ACCESS_REQUEST_EMAIL` – email address where Request access submissions are sent.
- `RESEND_FROM` – optional from-address, e.g. `"Campus Mobility <no-reply@yourdomain.edu>"`. If omitted, a Resend default is used.
- `NEXT_PUBLIC_CLAIM_BASE_URL` – base URL for claim links (Fleet export, Create tokens, copy URL). Set to your live domain so NTAGs and exports use the correct URL. Defaults to `https://campusmobilityproject.com` if unset.

## Claim domain and token programming

Claim URLs have the form `{NEXT_PUBLIC_CLAIM_BASE_URL}/claim/{token-uuid}`. To connect physical NTAGs to your system:

1. **Set the domain:** In `.env.local` (and in Vercel for production), set `NEXT_PUBLIC_CLAIM_BASE_URL` to your live domain, e.g. `https://campusmobilityproject.com`.
2. **Existing tokens (5 in system):** In the dashboard, open **Fleet**, select the tokens, and use **Export claim URLs** to get a CSV of claim URLs. Program each NTAG with its claim URL (or use **Copy URL** per row).
3. **New tokens (e.g. 5 more):** In **Settings** → **Token & Domain Management** → **Create new tokens**, enter the number (e.g. 5), click **Create tokens**, then copy the listed URLs and program each NTAG. Assign campaign and organization in the Fleet tab afterward.

All claim URLs use the same base; changing `NEXT_PUBLIC_CLAIM_BASE_URL` and redeploying updates links everywhere (Fleet copy, export, Create tokens).

## Production deployment

Before going live, see **[docs/PRODUCTION_READY.md](docs/PRODUCTION_READY.md)** for:

- Environment variables to set in production
- Required Supabase migrations (including `site_settings` for the configurable redemption success message)
- Post-deploy smoke checks

Run `npm run lint` and `npm run build` before deploying; both should pass with zero errors.

## Database: access_requests

The landing page **Request access** form:

- Inserts a row into the `public.access_requests` table (via a server action using the Supabase service role).
- Sends an email via Resend to `ACCESS_REQUEST_EMAIL` with the submitted details.

The migration for this table lives in:

- `supabase/migrations/20260129_000009_access_requests.sql`

