# Demo Production Polish Plan

**Goal:** Tighten the codebase for live demos and presentations so it reads as an **enterprise-grade MVP**—polished enough to win investment (e.g. $100M endowments) and first deals. No new features; polish only. The app should run like a well-oiled machine and need minimal maintenance as it scales.

**Principles:**
- Polish, don’t break. No heavy new integrations between tabs.
- Take time; execute in phases so each step is reviewable.
- This plan is the single checklist the team (or AI) follows; tick items as done.

**Responsive strategy:**
- **Landing page** and **login page** must be **mobile-friendly** (readable, tappable, and usable on phones and small screens). Students and staff may hit these from mobile first.
- **Once signed in**, the Command Center (dashboard: Map, Fleet, Campaigns, Settings) is **desktop-first for now**—optimized for laptop/desktop use in demos and operations. Mobile layout improvements for the dashboard are out of scope for this polish pass.

---

## Phase 0: Redemption Success Message (Configurable Note)

**Scope:** After a successful claim, show a small note below the Venmo message. SuperAdmins edit this note in Settings; it appears on the redemption success page for all campaigns.

**Deliverables:**
- [ ] **Data:** Add a simple store for “redemption success note” (e.g. `site_settings` or `profiles`-level key, or a single `settings` row). Option: env var `NEXT_PUBLIC_REDEMPTION_SUCCESS_NOTE` for MVP if you prefer no DB change.
- [ ] **Settings (SuperAdmin):** In Settings tab, add a section “Redemption success message” with a textarea (and optional “Website link” URL). Save to DB or server-side config. Character limit (e.g. 200) and sanitize for display.
- [ ] **Claim success page:** In `components/claim-form.tsx`, after “Payout will be sent to your Venmo.” render the configurable note (and optional link) below it. Fetch from server (e.g. server component or small API/action that returns the note). If empty, show nothing.
- [ ] **Docs:** Update UI_VOCABULARY or a short “Claim flow” doc to mention this message and where it’s edited.

**Out of scope for polish:** Per-campaign override (future); keep one global note for now.

---

## Phase 1: Codebase Hygiene & Consistency

**Goal:** Consistent patterns, fewer surprises, easier maintenance.

- [ ] **Lint & types:** Fix all existing lint errors and TypeScript strict issues (e.g. Supabase `never` types). No new warnings on `npm run build` and `npm run lint`.
- [ ] **Env & config:** Single source of truth. Document all env vars in README and optionally in a small `docs/ENV.md`. No secrets in client bundles; use `NEXT_PUBLIC_*` only where needed.
- [ ] **Error boundaries:** Ensure critical flows (dashboard, claim page) have error boundaries so one failure doesn’t white-screen. Add minimal fallback UI and optional logging.
- [ ] **Loading & empty states:** Every tab and major list has a clear loading state and a friendly empty state (no raw “0 results” without copy). Buttons show loading (disabled + “Loading…”) where appropriate.
- [ ] **Console hygiene:** Remove or gate `console.log`/`console.debug` in production paths. Keep only intentional logging (e.g. errors) or use a small logger that no-ops in prod.

---

## Phase 2: Claim / Tap Experience (UX Polish)

**Goal:** Claim flow feels solid and trustworthy; no rough edges.

- [ ] **Claim page:** Accessibility (labels, focus order, one logical h1). Mobile-friendly layout and touch targets. Clear validation messages and one clear CTA.
- [ ] **Success state:** Redemption success message implemented in Phase 0. Copy is concise and professional (“ACCESS GRANTED”, “Asset Secured”, Venmo line, then configurable note). No duplicate or conflicting text.
- [ ] **Error state:** Friendly, non-technical message on failure; optional “Try again” without losing context where possible.
- [ ] **Claim URL & token:** Invalid or expired token shows a clear, branded message (not a generic 404). No leaking of internal IDs in copy if avoidable.

---

## Phase 3: Dashboard Tabs & Cross-Tab Coherence

**Goal:** Tabs behave predictably; navigation and scope are clear. No heavy new integrations—just correctness and clarity.

- [ ] **Tab order & labels:** Confirm tab order and labels match UI_VOCABULARY and product intent (Map, Fleet, Campaigns, Settings). Active tab is obvious; URL/query reflects tab where applicable (e.g. `?tab=map`).
- [ ] **Scope consistency:** When user switches view (GLOBAL/TENANT) or org, data in Fleet, Campaigns, and Map reflects that scope. No stale data from previous scope; loading states when scope changes.
- [ ] **Cross-tab links:** Any links from one tab to another (e.g. “View in Fleet”, “View campaign”) go to the right place with correct context. No broken or misleading links.
- [ ] **Permissions:** SUPER_ADMIN vs ORG_ADMIN vs AUDITOR: buttons and sections that are write-only are hidden or disabled for non-authorized roles. No “success” on actions that should be forbidden.

---

## Phase 4: Performance & Reliability (Monolith-Friendly)

**Goal:** App feels fast and stable; scales without constant tweaks.

- [ ] **Server actions:** No unbounded queries. List endpoints (Fleet, Campaigns, Map tokens) use pagination or safe limits. Errors return clear messages; no stack traces to client.
- [ ] **Client data:** No single fetch that loads “all” of a large table without pagination. Dashboard doesn’t block on slow third-party calls; show cached or partial data with loading where needed.
- [ ] **Map:** Mapbox and token fetching don’t block the rest of the app. Errors (e.g. missing token) show inline message, not crash.
- [ ] **Caching & revalidation:** Next.js data fetching and server actions use sensible caching/revalidation where it matters (e.g. campaign list, org list). No unnecessary refetches on every keystroke.

---

## Phase 5: Security & Data Hygiene

**Goal:** Safe for demos and early production; no obvious leaks.

- [ ] **Auth:** Protected routes (dashboard, Settings, Fleet, etc.) require auth; redirect to login or landing when not signed in. Session handling is consistent (e.g. Supabase auth).
- [ ] **Inputs:** Server actions validate and sanitize inputs (IDs, amounts, text). No raw HTML from user content in redemption success note; escape or use safe components.
- [ ] **IDs in URL:** Token IDs and campaign IDs in URLs are validated (format, existence) before use. 404 or clear error for invalid IDs.
- [ ] **Sensitive data:** No secrets in client bundles; no PII in logs or error messages that go to the client.

---

## Phase 6: Copy, Branding & Final UX Pass

**Goal:** Every user-facing string is clear, professional, and on-brand.

- [ ] **Landing page & login (mobile-friendly):** Landing page and login page are usable and readable on phones: responsive layout, touch-friendly targets, no horizontal scroll, key CTAs visible. Per responsive strategy above, these are the only pages we polish for mobile in this pass.
- [ ] **Spelling & terminology:** One pass over dashboard, claim flow, Settings, and Fleet. Consistent terms (e.g. “Unclaimed”/“Claimed”, “Asset”, “Campaign”). Fix typos and unclear phrasing.
- [ ] **Tone:** Professional and concise. No dev jargon in UI; no placeholder text like “Lorem” or “Test” in production paths.
- [ ] **Redemption success note:** Copy edited and character limit enforced; link optional and clearly labeled (e.g. “Visit [website]”).
- [ ] **Empty states:** Every list and tab has a short, helpful empty-state message and, where relevant, a next step (e.g. “Create your first campaign”).

---

## Phase 7: Documentation & Handoff

**Goal:** Anyone (or any AI) can understand how to run, configure, and extend the app.

- [ ] **README:** Up to date: how to run (dev, build, env), main env vars, and link to key docs. No outdated commands or broken links.
- [ ] **UI_VOCABULARY.md:** Reflects current tabs, banners, and key terms. Mention redemption success message and where it’s configured.
- [ ] **Architecture/context:** SYSTEM_ARCHITECTURE.md or equivalent describes high-level structure (dashboard, claim flow, Supabase, Map). Optional: one-page “Demo script” (what to show in what order) for presenters.

---

## Execution Notes

- **Order:** Phase 0 (redemption message) can be done first so demos can use it. Phases 1–7 can be done in order or in parallel where there are no dependencies.
- **Testing:** After each phase, run `npm run build`, `npm run lint`, and a quick manual pass on: login → dashboard tabs → claim flow (submit → success screen) → Settings.
- **Sign-off:** Mark phase complete only when the checklist for that phase is done and no regressions are introduced.

---

## Quick Reference: Key Files

| Area | Primary files |
|------|----------------|
| Landing page (mobile-friendly) | `app/landing-page.tsx` or `app/page.tsx` |
| Login / auth (mobile-friendly) | Auth routes and components (e.g. Supabase auth callback, login UI) |
| Claim success UI | `components/claim-form.tsx` |
| Redemption note (Settings) | To add in Settings section of `app/dashboard-client.tsx`; storage TBD (DB or env) |
| Dashboard tabs | `app/dashboard-client.tsx` |
| Fleet | `app/dashboard-client.tsx` (FleetTab), `app/fleet/fleet-actions.ts` |
| Campaigns | `app/campaigns/`, `app/dashboard-client.tsx` (CampaignsTab) |
| Map | `components/map-view.tsx`, `app/fleet/fleet-actions.ts` (listTokensForMap, getMapAnalytics) |
| Settings | `app/dashboard-client.tsx` (SettingsTab) |
| Vocabulary | `docs/UI_VOCABULARY.md` |

---

*Last updated: plan created for demo production polish. Execute phases in order or as noted; tick items as completed.*
