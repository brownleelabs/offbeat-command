# Command Center — System Architecture

The Command Center is **one monolithic system**, not five separate tabs. All surfaces share the same auth, validation, audit, and data flow. This doc describes the system as a whole.

## Entry points

| Route / surface | Auth | Role | Purpose |
|-----------------|------|------|---------|
| `/` | Required | Any profile | Dashboard (Map / Fleet / Campaigns / Deal Desk / Settings by role) |
| `/login` | None | — | Sign-in |
| `/claim/[id]` | Public (excluded from proxy) | — | Student claim flow (token tap) |
| `/schools`, `/schools/[slug]` | Excluded from proxy | — | Public school pages |
| `/fleet/[id]` | Required | Fleet access | Asset detail (same data as Fleet tab modal) |
| `/campaigns/[id]` | Required | SUPER_ADMIN | Campaign detail |
| `/deal-desk` | Required | SUPER_ADMIN | Deal Desk (route guard in proxy) |
| `/responses/[id]` | Required | SUPER_ADMIN / ORG_ADMIN | Response detail |

## Shared auth and Supabase

- **Proxy** (`proxy.ts`): Runs on matched routes. Ensures user is logged in (except `/`, `/login`); redirects to login on auth failure; **SUPER_ADMIN-only** guard for `/deal-desk`.
- **Server auth** (single source of truth):
  - `lib/auth-server.ts`: `requireSuperAdmin()`, `requireProfile()`, `getSupabaseService()`, `getSupabaseAnon()`. Used by Fleet, Campaigns, Deal Desk, and app actions.
  - `lib/supabase-server.ts`: `createServerSupabase()` — request-scoped client with user RLS.
- **Client context**: `components/dashboard-context.tsx` — `useDashboard()` provides `userRole`, `orgId`, `profile`, `loading`, `authError` for the whole app.

## Shared validation

- **`lib/validation.ts`**: `isUuid` / `isUuidLike`, `clampInt`, `BATCH_LIMIT`, `MAX_PAGE_SIZE`, `MIN_PAGE_SIZE`. Used by fleet-actions, campaign-actions, scenario-actions, and app/actions (via `isValidUUID` alias).

## Module boundaries (server actions)

| Module | Auth | Validation | Mutations |
|--------|------|------------|-----------|
| `app/actions.ts` | Inline SUPER_ADMIN checks, `getSupabaseService` / `getSupabaseAnon` from auth-server | `isUuid` (validation) | Users, orgs, role permissions, access requests, claim submit |
| `app/fleet/fleet-actions.ts` | `requireSuperAdmin()`, `requireFleetAccess()` (uses `requireProfile`) | `isUuidLike`, `clampInt`, `BATCH_LIMIT` from validation | Tokens CRUD, assign campaign/org, export URLs, fund, delete, audit |
| `app/campaigns/campaign-actions.ts` | `requireSuperAdmin()` from auth-server | `isUuidLike`, `clampInt` from validation | Campaigns CRUD, archive, soft delete, pin, audit |
| `app/deal-desk/scenario-actions.ts` | `requireSuperAdmin()` from auth-server | `isUuidLike`, `clampInt` from validation | Deal scenarios CRUD |

## Cross-tab data flow

- **Dashboard** (`app/dashboard-client.tsx`): Single root component. Tabs are views over shared state (e.g. `campaigns`, `tokens`, `organizations`). `loadData()` refreshes campaigns, orgs, responses count; `loadFleetList(page)` refreshes fleet rows; `loadCampaignsList(page, …)` refreshes campaigns and token counts.
- **Invalidation**: After Fleet mutations (assign campaign, assign school, create tokens, delete token, load funds), the code calls `loadFleetList(fleetPage)` or `loadFleetList(1)`. After Settings “Create tokens”, `onTokensCreated()` runs and calls `loadFleetList(1)` so Fleet total is correct when the user switches tabs. Campaigns tab refetches when selected (useEffect with `activeTab`, `campaignPage`, etc.), so asset counts stay in sync.

## Error handling

- **Dashboard error boundary** (`components/dashboard-error-boundary.tsx`): Wraps `DashboardProvider` in the root layout. Catches runtime errors in any tab so one failing tab does not white-screen the whole app; shows “Something went wrong” and Try again / Go to dashboard.
- **Per-tab errors**: Fleet uses `fleetError`; Campaigns use `assignCampaignMessage` / save errors; Deal Desk uses `saveError`; Settings use form-level messages. All server actions return `{ success: false, error: string }` for consistent handling.

## Audit

- **Campaigns**: `campaign_audit_log` — created, launched, updated, archived, deleted, viewed, pinned, etc.
- **Fleet**: `fleet_audit_log` — campaign_assigned, organization_assigned, urls_exported, token_created, token_reloaded, token_deleted, token_funded.
- **Deal Desk**: Scenarios are CRUD; no separate audit table (can be added later).

## RLS and service role

- **RLS**: Tokens, campaigns, responses, organizations, profiles, role_permissions, and audit tables have RLS. Reads use `createServerSupabase()` (user context). Writes that must bypass RLS (e.g. token insert, org delete) use `getSupabaseService()` from auth-server, only after role checks in server actions.
- **Never** expose `SUPABASE_SERVICE_ROLE_KEY` to the client. All service-role usage is in server actions (or API routes) after auth.

## Summary

- **One system**: Shared auth (proxy + auth-server), shared validation, shared Supabase access, and coordinated refresh across Map, Fleet, Campaigns, Deal Desk, and Settings.
- **Hardening**: Centralize auth and validation in `lib/auth-server.ts` and `lib/validation.ts`; use a single error boundary for the dashboard; keep cross-tab invalidation explicit (e.g. `onTokensCreated` → `loadFleetList(1)`).
