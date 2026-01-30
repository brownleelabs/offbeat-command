# Production Readiness Checklist

Use this checklist before going live. The codebase is **build- and lint-clean**; these steps ensure environment and data are ready.

---

## 1. Code verification (already done)

- [x] **Lint:** `npm run lint` — 0 errors, 0 warnings
- [x] **Build:** `npm run build` — compiles and generates static/dynamic routes
- [x] **Phases 0–5** from [DEMO_PRODUCTION_POLISH_PLAN.md](./DEMO_PRODUCTION_POLISH_PLAN.md) implemented (redemption message, hygiene, claim UX, dashboard coherence, performance, security)

---

## 2. Environment variables (production)

Set these in your production host (e.g. Vercel → Project → Settings → Environment Variables). Do **not** commit real keys to the repo.

| Variable | Required | Notes |
|----------|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only; used for claim page and access requests |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Yes | Map tab; public token is intentional |
| `NEXT_PUBLIC_CLAIM_BASE_URL` | Recommended | Live domain for claim links (e.g. `https://yourdomain.com`). Defaults to `https://campusmobilityproject.com` if unset |
| `RESEND_API_KEY` | Yes (if using Request access) | Resend API key for landing-page form |
| `ACCESS_REQUEST_EMAIL` | Yes (if using Request access) | Where access request emails are sent |
| `RESEND_FROM` | Optional | From address for Resend (e.g. `"Your Project <noreply@yourdomain.com>"`) |
| `NEXT_PUBLIC_MAPBOX_STYLE_URL` | Optional | Custom Mapbox style URL |

---

## 3. Database migrations

Run all migrations in your **production** Supabase project (Dashboard → SQL Editor or `supabase db push` if using CLI).

**Critical for redemption success message:**

- `supabase/migrations/20260129000026_site_settings.sql` — creates `site_settings` (redemption success note/link). If this is not applied, the Settings → “Redemption success message” section will fail; claim success page will show no custom note.

Apply migrations in order (by filename). If you’ve already applied earlier migrations, run only any that are missing (e.g. `20260129000026_site_settings.sql`).

---

## 4. Post-deploy checks

After deploying:

1. **Landing:** Visit `/` — landing and “Request access” form load; submit test (if Resend configured) and confirm email.
2. **Auth:** Sign in — redirect to dashboard; sign out and confirm redirect to landing/login.
3. **Claim flow:** Open a claim URL `/claim/{token-uuid}` (use a real token ID from Fleet) — complete claim and confirm success message and optional redemption note from Settings.
4. **Dashboard:** Open Map, Fleet, Campaigns, Settings — no white screen; SuperAdmin can open Deal Desk and edit redemption message in Settings.
5. **Schools:** Visit `/schools` and a school slug — map loads (Mapbox token required).

---

## 5. Optional: health check

For monitoring or load balancers, you can add a simple health route (e.g. `app/api/health/route.ts` returning 200) or rely on your host’s default (e.g. Vercel’s “/” or “/api” probe). The existing `supabase/health_check.sql` is for ad-hoc DB checks in the Supabase SQL Editor.

---

## Summary

| Step | Status |
|------|--------|
| Lint clean | ✅ |
| Build success | ✅ |
| Env vars documented | ✅ (this doc + README) |
| Migrations (incl. `site_settings`) | ⬜ Run in prod Supabase |
| Production env vars set in host | ⬜ You |
| Post-deploy smoke test | ⬜ You |

Once migrations are applied and production env vars are set, you’re **prod ready**.
