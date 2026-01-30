# NotebookLLM prompt: Fleet Audit, Domain, and Robustness

**Copy everything below the line into NotebookLLM (where your company files are) to get implementation help.**

---

You are helping implement the **Fleet Audit, Domain, and Robustness** work for the Campus Mobility Project Control Center. Follow the plan and match existing patterns in this codebase.

## 1. Plan and context

- **Full plan:** Read **docs/FLEET_AUDIT_AND_DOMAIN_PLAN.md** for goals, robustness parity with Campaigns/Deal Desk, audit design, Settings additions, and error-handling rules.
- **Implementation checklist (order):** Read the “Order of implementation” section in **.cursor/plans/fleet_audit_and_domain_03dd5c0e.plan.md** if that file exists; otherwise use this order:
  1. **Constant:** `CLAIM_BASE_URL` and `getClaimUrl` in **lib/constants.ts** (already present—use them everywhere claim URLs are built).
  2. **DB:** **supabase/migrations/20260129_000011_fleet_audit_log.sql** (fleet_audit_log table + RLS + indexes; tokens indexes). Verify it exists and is applied.
  3. **Server actions:** **app/fleet/fleet-actions.ts** — implement or verify: `logFleetAudit`, `listTokens`, `assignTokensToCampaign`, `getFleetAuditLog`, `bulkAssignTokensToSchool` (with audit), `exportClaimUrls`. All return `{ success, error }` or structured result; validate UUIDs and batch size; never throw.
  4. **Dashboard Fleet tab:** **app/dashboard-client.tsx** — for the Fleet tab only: load data via **listTokens** server action (paginated), not client-side unbounded Supabase. Add: fleet state (fleetPage, fleetPageSize, fleetTotal, fleetLoading, fleetError, optional filters). Replace “Set Campaign” with **assignTokensToCampaign**. Keep “Transfer Fleet” calling **bulkAssignTokensToSchool** (from fleet-actions, with audit). Add: Copy URL (getClaimUrl), Copy ID, Export claim URLs button, “Recent activity” (getFleetAuditLog). Loading, error, empty, and pagination UX.
  5. **Settings tab:** In **app/dashboard-client.tsx** (SettingsTab): add Token management instructions (from **docs/TOKEN_AND_DOMAIN_MANAGEMENT_PLAN.md**), one line “Claim base URL: https://campusmobilityproject.com”, and a note that fleet operations are audited and the audit trail is in the Fleet tab.
  6. **Consistency:** Everywhere a claim URL is built or shown (Fleet copy, export CSV, Settings, responses link if needed), use **getClaimUrl** from **lib/constants.ts**. No raw string concatenation for claim URLs.

## 2. Reference files (read these for patterns)

| Purpose | File |
|--------|------|
| Plan (goals, audit, robustness, Settings, errors) | **docs/FLEET_AUDIT_AND_DOMAIN_PLAN.md** |
| Campaign audit pattern (table + RLS) | **supabase/migrations/20260129_000007_campaign_audit_log.sql** |
| Fleet audit table + tokens indexes | **supabase/migrations/20260129_000011_fleet_audit_log.sql** |
| Server-actions style (list, mutations, audit, no throw) | **app/campaigns/campaign-actions.ts** |
| Claim URL constant + helper | **lib/constants.ts** (CLAIM_BASE_URL, getClaimUrl) |
| Safe Server Component (validate UUID, try/catch, no throw) | **app/claim/[id]/page.tsx** |
| Bulk assign (move or wrap with audit) | **app/actions.ts** (bulkAssignTokensToSchool) |
| Fleet actions (listTokens, assign, audit, export) | **app/fleet/fleet-actions.ts** |
| Dashboard Fleet tab (loadData, Set Campaign, FleetTab) | **app/dashboard-client.tsx** |
| Token management instructions for Settings | **docs/TOKEN_AND_DOMAIN_MANAGEMENT_PLAN.md** |

## 3. Rules to follow

- **Server actions:** Try/catch; return `{ success: false, error }` or structured result; validate UUIDs and batch size (e.g. 200) before DB; never throw.
- **Audit:** After every fleet mutation (assign campaign, assign org, export URLs), call **logFleetAudit(eventType, actorUserId, payload)**. Non-blocking insert; do not throw.
- **List:** Use **listTokens** with `.range(from, to)`; never unbounded client Supabase for Fleet list. Design for ~10k tokens.
- **Claim URLs:** Always use **getClaimUrl(tokenId)** from **lib/constants.ts**; base URL is `https://campusmobilityproject.com` (hardcoded for v1).
- **Server Components:** If any new Server Component loads fleet/token data: validate UUID, try/catch, return null or safe UI on error; never throw in render (same pattern as **app/claim/[id]/page.tsx**).
- **Dashboard:** Fleet tab must show loading, error (with retry), and empty states; pagination and page-size selector; success/error feedback for Set Campaign, Transfer Fleet, and Export.

## 4. What to do

1. **Confirm** which of the above steps are already done (constants, migration, fleet-actions, dashboard Fleet, Settings).
2. **Implement or fix** whatever is missing or inconsistent with the plan.
3. **Use only** the files and paths listed above (and the rest of this repo); do not invent new paths or env vars except as already documented (e.g. future `NEXT_PUBLIC_CLAIM_BASE_URL`).
4. **Match** the style of **app/campaigns/campaign-actions.ts** for server actions and **supabase/migrations/20260129_000007_campaign_audit_log.sql** for audit table/RLS.

When you change **app/dashboard-client.tsx**, keep existing behavior for other tabs (Campaigns, Map, Settings, etc.); only the Fleet tab should switch to **listTokens** and the new Fleet state and actions above.
