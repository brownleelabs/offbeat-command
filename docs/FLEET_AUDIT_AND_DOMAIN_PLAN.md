# Fleet Tab, Auditability, and Domain Plan

Use this document together with **TOKEN_AND_DOMAIN_MANAGEMENT_PLAN.md**. This doc focuses on: **auditability and value tethering** ($25 + accruing interest digitally tethered to token URL), **tight management** of URLs/IDs, **what the Fleet tab needs**, **what SuperAdmin Settings must add to support fleet operations**, and **hardcoding campusmobilityproject.com** (owned and operated by Offbeat Options). **Fleet is to be built to the same robustness as the Campaigns and Deal Desk tabs**—server actions, audit, validation, pagination, and error/loading states. Planning only—no code.

**Project mission (from README):** Campus Mobility Project Control Center—authenticated users see the admin dashboard (fleet, campaigns, map, settings). Campaigns are the data-collection engine; tokens are the physical tether to campaigns and to the $25+ interest value chain. Fleet must be a first-class, auditable, scale-ready tab like Campaigns and Deal Desk.

---

## 1. Auditability and value tethering

### 1.1 Why this must be auditable and tight

- **$25 (plus any accruing interest) is digitally tethered to the token URL.** One token ID → one claim URL → at most one claim (one response per token_id via unique constraint) → one payout verification. The chain of record is: **token_id → response (immutable) → campaign → payout.** If URLs, IDs, or assignments are wrong or untracked, the financial and compliance chain breaks.
- **Management of URLs, IDs, and assignments must be tight:** No public listing of token IDs or claim URLs; only authorized Command Center users. Token creation and URL generation only server-side. Every material fleet operation (assign campaign, assign org, export URLs, create token) should be **auditable**: who did what, when, and to which tokens.

### 1.2 Existing chain of record (codebase)

- **responses** table: Immutable rows; `token_id`, `campaign_id`, `organization_id`, KYC fields, `claim_metadata`. Unique on `token_id` (one claim per token). This is the payout/claim chain.
- **campaign_audit_log**: Append-only; campaign_id, event_type, actor_user_id, at, payload. Used for campaign lifecycle (created, launched, updated, archived, etc.). **There is no audit today for token/fleet operations** (Set Campaign, Transfer Fleet, or future Export URLs / Create token).

### 1.3 What we need for fleet/token audit

- **Token/fleet audit trail:** Every material change to tokens or to URL exposure should be logged: who assigned which tokens to which campaign or org, who exported claim URLs (and how many), who created tokens (when we add it). Same pattern as campaign_audit_log: append-only table, event types, actor_user_id, at, payload (token_ids, campaign_id, organization_id, count, etc.).
- **Server-side fleet writes:** Move "Set Campaign" from client-side Supabase update to a **server action** that (1) updates tokens and (2) writes to the token/fleet audit log. Keep "Transfer Fleet" (bulkAssignTokensToSchool) as server action but **add audit log write** so the assignment is recorded.
- **Export URLs:** When we add "Export claim URLs," the action must write an audit event (who, when, how many tokens, optional filter by campaign/org) so URL exposure is auditable.

---

## 2. Tight management of URLs and IDs

- **Single canonical claim URL:**  
  `https://campusmobilityproject.com/claim/<token-uuid>`
- **Domain:** **campusmobilityproject.com** is now owned and operated by **Offbeat Options**. We can **hardcode** this domain wherever the claim base URL is needed (claim link generation, instructions, export). No need for a configurable base in the first version; if staging is needed later, one env var (e.g. `NEXT_PUBLIC_CLAIM_BASE_URL`) can override.
- **IDs:** Token IDs are UUIDs; never guessable or enumerable in public. Optional signed claim URLs (see TOKEN_AND_DOMAIN_MANAGEMENT_PLAN) make links unguessable even if token IDs leak.
- **Who can see/generate:** Only authorized Command Center users (SuperAdmin or Fleet write permission). Claim URLs are not listed publicly; copy and export are gated and (when implemented) audited.

---

## 3. Fleet tab — codebase review and what’s needed

### 3.1 What exists today (from codebase)

- **Data:** Tokens loaded from `tokens` with join to `campaigns(name)` and `organizations(name)`. Filter by `organization_id` when org-scoped (ORG_ADMIN). Realtime subscription on `tokens` updates.
- **FleetTab UI:** Table with columns: checkbox, Organization (SuperAdmin/Auditor only), Asset ID (truncated `...last8`), Coordinates, Active Campaign, Status. Actions: "Set Campaign" (dropdown + button), "Transfer Fleet" (org dropdown + button for SuperAdmin), "Refresh."
- **Set Campaign:** Client-side `supabase.from("tokens").update({ campaign_id }).in("id", validTokenIds)`. No server action, no audit.
- **Transfer Fleet:** Server action `bulkAssignTokensToSchool(tokenIds, organizationId)` — SUPER_ADMIN only; updates `tokens.organization_id`. No audit log.
- **Permissions:** `fleet_write` from role_permissions; SuperAdmin always has full access. ORG_ADMIN can Set Campaign (if fleet_write) and Transfer Fleet only to their own org.

### 3.2 What the Fleet tab needs (to support auditable, tight operations)

| Need | Purpose |
|------|--------|
| **Claim URL per token** | Show claim URL (or "Copy URL" button) for each row so staff can program NTAGs. Gated by fleet_write or SuperAdmin. Use hardcoded base `https://campusmobilityproject.com/claim/` + token.id. |
| **Full token ID copy** | Option to copy full UUID (e.g. for bulk CSV or vendor). Keeps Asset ID column readable (truncated) but allows "Copy ID" or "Copy URL" per row. |
| **Export claim URLs** | Bulk export: CSV (or similar) with token_id, claim_url, campaign name, org name for selected tokens (or filtered set). Gated; **must write audit log** (who, when, how many, scope). |
| **Set Campaign via server action** | Replace client-side update with a server action that (1) updates tokens and (2) writes to token/fleet audit log (event e.g. `campaign_assigned`: actor, token_ids, campaign_id, count). |
| **Transfer Fleet audit** | Keep existing server action; add audit log write (event e.g. `organization_assigned`: actor, token_ids, organization_id, count). |
| **Fleet audit trail view** | In Fleet tab (or linked from it): list of recent token/fleet audit events (who assigned what, when; who exported URLs, when). SuperAdmin-only or gated by permission. Enables "why did this token move?" and compliance. |
| **Filters** | Optional: filter by campaign, status (active/found), organization so large fleets are manageable. Today filter is org-only (dataScopeOrgId). |
| **Token creation** | Not in Fleet tab initially—instructions and (later) "Add token" may live in Settings or a shared flow. Fleet remains "view, assign, copy URL, export." |

### 3.3 Summary: Fleet tab additions

- **List:** Replace unbounded client fetch with `listTokens` server action (pagination, pageSize, filters, total count). Loading and error states; empty state; retry on error. See §4 (robustness parity).
- **Display:** Claim URL column or per-row "Copy URL" (and optionally "Copy ID"); hardcoded base `https://campusmobilityproject.com/claim/<id>`.
- **Actions:** Set Campaign → server action (assignTokensToCampaign) + audit + batch limit. Transfer Fleet → add audit (and optional batch limit). New: Export claim URLs (server action + audit).
- **Audit:** New token/fleet audit table + events; Fleet audit trail view ("Recent activity") for SuperAdmin; getFleetAuditLog(limit).
- **Optional:** Filters by campaign, status; page size selector (e.g. 25/50/100); stable sort if we add pinned/sort later.

---

## 4. Robustness parity with Campaigns and Deal Desk

We are building the Fleet tab up to have **the same robustness** as the Campaigns and Deal Desk tabs. Below is a vulture-style review of what those tabs do and what Fleet must do to match.

### 4.1 What Campaigns and Deal Desk do (from codebase)

**Campaigns tab (campaign-actions.ts, dashboard CampaignsTab, campaign detail page):**

- **Dedicated server-actions module:** `app/campaigns/campaign-actions.ts` — all list/mutation/get/audit in one place. No client-side direct Supabase writes to campaigns or campaign_audit_log.
- **List:** `listCampaigns(input)` — server action with pagination (`page`, `pageSize` clamped 10–200), `searchQuery` (UUID or name with ILIKE escape), `showArchived`, `showDeleted`, `status` filter. Returns `{ success, rows, total }` or `{ success: false, error }`. Uses `.range(from, to)` — never unbounded. Design scale 10k campaigns; indexes on created_at, organization_id, pinned, name (trigram).
- **Get one:** `getCampaign(id)` — UUID validation first; returns `{ success, campaign }` or `{ success: false, error }`. Used by detail page.
- **Audit log:** `logCampaignAudit(...)` — non-blocking insert after every mutation; event types (created, launched, updated, archived, etc.). `getCampaignAuditLog(campaignId, limit)` — returns recent events for "Recent activity" on detail page.
- **Mutations:** `insertCampaign`, `updateCampaign`, `archiveCampaigns`, `softDeleteCampaigns`, `updateCampaignPinned`, `markCampaignViewed` — all call `requireSuperAdmin()`, validate inputs (UUID, name length, questions count), use allow-lists (e.g. ALLOWED_CAMPAIGN_KEYS), then mutate and call `logCampaignAudit`. Return `{ success }` or `{ success: false, error }`. Batch operations have limits (e.g. 200 for archive).
- **Detail page:** Loading, notFound, saveError states; UUID validation before fetch; confirm for delete; Response Ledger with display limit (200) and total count; collapsible "Recent activity" (audit log).
- **Error handling:** try/catch in every server action; return structured error; never throw. Client shows error message; no silent swallow.

**Deal Desk tab (scenario-actions.ts, deal-desk page):**

- **Dedicated server-actions module:** `app/deal-desk/scenario-actions.ts` — list, insert, update, archive, softDelete, pin. No client-side direct writes to deal_scenarios.
- **List:** `listDealScenarios(input)` — pagination (page, pageSize clamp 10–200), searchQuery (UUID or name/university with escape), showArchived, showDeleted. Returns `{ success, rows, total }` or `{ success: false, error }`. Uses `.range(from, to)`.
- **Mutations:** All require SuperAdmin; UUID validation; return `{ success, error }`. Stable sort (pinned first, then created_at).
- **UI:** Rows selector (25/50/100), search, pagination, loading/error handling.

### 4.2 Current Fleet gaps (vs Campaigns / Deal Desk)

- **No dedicated fleet-actions module** — only `bulkAssignTokensToSchool` in `app/actions.ts`. Set Campaign is **client-side** `supabase.from("tokens").update(...)` — no server action, no audit, no batch limit, no central validation.
- **No listTokens server action** — Fleet loads tokens in dashboard `loadData()` with client Supabase: `.select("*, campaigns(name), organizations(name)").order("id")` and optional org filter. **Unbounded** — no pagination, no `.range()`, no total count from server. Does not scale to 1000+ tokens.
- **No loading/error UX for token list** — on error, `setTokens([])` with no user-visible "Failed to load" or retry. Campaigns list shows loading and error message.
- **No batch limits** — Set Campaign can update any number of selected tokens; bulkAssignTokensToSchool has no cap. Campaigns cap archive/delete at 200.
- **No fleet audit log** — no table, no write on assign campaign/org, no "Recent activity" in Fleet.
- **No filters** — only org filter (dataScopeOrgId). Campaigns have status, showArchived, showDeleted; Deal Desk has showArchived, showDeleted.
- **No stable sort** — tokens ordered by id only; Campaigns/Deal Desk use pinned first, then created_at, then id.

### 4.3 Fleet requirements to match robustness

| Area | Requirement (match Campaigns / Deal Desk) |
|------|-------------------------------------------|
| **Server-actions module** | Add `app/fleet/fleet-actions.ts` (or equivalent): `listTokens`, `assignTokensToCampaign`, `exportClaimUrls`, `getFleetAuditLog`. Move or mirror `bulkAssignTokensToSchool` so it (or a wrapper) writes fleet audit. All mutations server-side only. |
| **List** | `listTokens(input)`: `page`, `pageSize` (clamp e.g. 10–200), optional filters `campaignId`, `status` (active/found), `organizationId` (org scope). Optional `searchQuery` (token UUID). Return `{ success, rows, total }` or `{ success: false, error }`. Use `.range(from, to)`; never unbounded. Design scale e.g. 10k tokens; indexes on tokens (organization_id, campaign_id, status). |
| **Mutations** | `assignTokensToCampaign(tokenIds, campaignId)`: validate UUIDs, batch limit (e.g. 200), require SuperAdmin or fleet_write + org scope, update tokens, call `logFleetAudit('campaign_assigned', ...)`, return `{ success, count }` or `{ success: false, error }`. `bulkAssignTokensToSchool`: add `logFleetAudit('organization_assigned', ...)`; optional batch limit. `exportClaimUrls`: server action, gated, write audit event `urls_exported`, return CSV or blob. |
| **Audit** | `token_audit_log` (or `fleet_audit_log`) table; `logFleetAudit(eventType, actorUserId, payload)` non-blocking. `getFleetAuditLog(limit)` for "Recent activity" in Fleet tab. Event types: campaign_assigned, organization_assigned, urls_exported, token_created. |
| **UI: list** | Replace client-side token fetch with call to `listTokens`. Show loading state; on error show message and retry. Empty state when total === 0. Pagination controls (page, page size selector e.g. 25/50/100). Optional filters: campaign dropdown, status (All/Active/Found), org already present. |
| **UI: mutations** | Success/error message after Set Campaign and Transfer Fleet; loading flags on buttons; no silent swallow. Optional confirm for "Transfer Fleet" (high-impact). |
| **Validation** | All token IDs and campaign/org IDs validated as UUID in server actions before DB. Batch size clamped. |
| **Scale-readiness** | Indexes on tokens for list filters (organization_id, campaign_id, status). Audit log indexed by at desc, actor_user_id. No "select *" without range for list. |

### 4.4 VULTURE-style Fleet checklist (before and after implementation)

Use this checklist so Fleet is as robust as Campaigns and Deal Desk:

- **Auth:** Every list/mutation gated by SuperAdmin or fleet_write (and org scope for ORG_ADMIN). No client-side-only bypass. Server actions use requireSuperAdmin() or equivalent and server Supabase.
- **List:** Server-side pagination and count; no unbounded load; loading and error states; empty state; retry on error.
- **Mutations:** All via server actions; batch limits (e.g. 200); UUID validation; audit log write after each mutation; return { success, error }; UI shows result.
- **Audit:** Append-only token/fleet audit log; event types match actions; getFleetAuditLog for "Recent activity"; non-blocking log insert.
- **Validation:** Token IDs, campaign ID, organization ID validated (UUID) before DB; search query escaped if we add text search.
- **500 avoidance:** No throw in server actions; try/catch return { success: false, error }; no throw in Server Components that load fleet data (see §6).
- **Scale:** Design for 10k+ tokens; list uses range; indexes on tokens and audit log.

After Fleet is built, a **VULTURE Fleet** pass (like VULTURE_CAMPAIGNS.md) can audit Fleet end-to-end for bugs, edge cases, and consistency with this plan.

---

## 5. SuperAdmin Settings — what to add to support fleet operations

Settings does not host fleet *operations* (those stay in Fleet tab). Settings supports fleet by:

### 4.1 Token management instructions (already in TOKEN_AND_DOMAIN_MANAGEMENT_PLAN)

- Full step-by-step for **one-off** and **bulk (1000+)** token add.
- Emphasize: URLs connect to campaigns; $25 + interest is tethered to token URL; keep URLs and IDs tight and auditable.

### 4.2 Canonical base URL (hardcoded)

- In Settings, show one line: **Claim base URL: https://campusmobilityproject.com** (owned and operated by Offbeat Options). Hardcode in app for claim link generation, export, and instructions. No configurable field required for v1.
- If we later need staging or multiple domains, introduce `NEXT_PUBLIC_CLAIM_BASE_URL` and default it to `https://campusmobilityproject.com`.

### 4.3 Audit and compliance note

- Short note in Token management section: "Fleet operations (assign campaign, assign org, export URLs) are audited. View the fleet audit trail in the Fleet tab." So SuperAdmin knows where to look for "who did what."

### 4.4 What not to put in Settings

- SETTINGS_PLANNING_AGENT_SPEC says: do not add fleet, campaigns, or map *features* inside Settings. So: no token list, no Set Campaign, no Export in Settings. Only **instructions**, **base URL display**, and **pointer to Fleet audit**.

---

## 6. Token / fleet audit log (design)

- **Table (e.g. `token_audit_log` or `fleet_audit_log`):** Same pattern as `campaign_audit_log`: append-only. Columns: id, event_type, actor_user_id, at (timestamptz), payload (jsonb). Optionally token_ids (array) or count for quick querying.
- **Event types (examples):** `campaign_assigned`, `organization_assigned`, `urls_exported`, `token_created` (when we add token creation). Payload: e.g. `{ token_ids: string[], campaign_id?: string, organization_id?: string, count: number, export_scope?: string }`.
- **RLS:** SuperAdmin (and optionally Auditor) can read; only server-side code (service role or authenticated SuperAdmin action) can insert. No update/delete.
- **Fleet tab:** "Audit" or "Recent activity" section or link that lists recent events (who, what, when, scope). Pagination or limit (e.g. last 100).

---

## 7. Error handling and 500 avoidance

Build into the plan so we avoid **500 errors** and the generic production message: *"An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error."*

### 7.1 Why that message appears

- Next.js **intentionally omits** the specific error message in production to avoid leaking sensitive details (DB errors, paths, env). The **digest** is a hash that can help correlate logs; it does not expose the message to the user.
- That message is shown when an **uncaught error** is thrown during **Server Component render** (or during server-side data fetching used in render). To avoid it, we must **never let uncaught errors reach the render path**—validate early, catch exceptions, and return safe UI or structured errors instead of throwing.

### 7.2 Plan: avoid 500s and uncaught errors

- **Validate at boundaries:** Before any DB or external call, validate inputs (e.g. UUID format for token/campaign IDs, auth present). Invalid input → return a safe result (null, `{ success: false, error: "..." }`, or render a safe error UI) instead of calling the DB and letting it throw. The claim page already does this: invalid UUID → return null; page renders `<ErrorScreen>` instead of throwing.
- **Try/catch in server code:** Wrap all server-side data access (Supabase, server actions, Server Component async work) in try/catch. On catch: log for debugging (server-only), return null or a structured error or render a safe fallback UI—**do not rethrow** into the render path. The claim page’s `getTokenForClaim` returns null on any exception so the page can render "TOKEN NOT FOUND" instead of 500.
- **Server Components: never throw in render.** In async Server Components, if data loading fails or returns null, render a **safe fallback** (e.g. "Not found", "Something went wrong" without details) or use `notFound()` where appropriate. Do not throw raw errors from fetch or DB; handle them and then render.
- **Server actions: return structured errors.** Server actions should return `{ success: boolean, error?: string, ... }` (or similar) instead of throwing. Let the client show the error message; avoid uncaught throws that can surface as 500 or the generic digest message. Existing actions (e.g. `bulkAssignTokensToSchool`, `submitClaim`) already follow this pattern.
- **Env and config:** Before using Supabase or other services, check that required env vars exist. If missing, return null or a safe error response instead of calling the client and letting it throw (claim page’s `getSupabaseAdmin()` returns null if keys missing; caller handles null).
- **New fleet/claim/export code:** Apply the same rules: validate token IDs and campaign IDs (e.g. UUID regex) before DB; try/catch around all server-side work; server actions return `{ success, error }`; Server Components that load data handle null/failure with a safe UI, never throw.

### 7.3 Reference: existing good pattern (claim page)

- **`app/claim/[id]/page.tsx`:** Normalizes and validates token ID (UUID) before any DB call; `getTokenForClaim` uses try/catch and returns null on error or invalid UUID; page component never throws—it renders `<ErrorScreen>` for invalid or not-found, and the form only when data is valid. Use this pattern for any new Server Component or server action that touches tokens, campaigns, or claim/export flows.

### 7.4 Optional: error boundaries

- **Client:** A React error boundary can catch client-side render errors and show a generic "Something went wrong" UI instead of a white screen. It does not fix server-side 500s; those are avoided by the rules above.
- **Server:** The main lever is **not throwing** from Server Components. Next.js does not expose a server-side "error boundary" in the same way; the fix is defensive coding: validate, catch, return safe UI.

---

## 8. Domain: campusmobilityproject.com (Offbeat Options)

- **Fact:** The domain **campusmobilityproject.com** is now **owned and operated by Offbeat Options.** Hardcode this wherever the claim base URL is used:
  - Claim link generation (claim page, export CSV, copy URL).
  - Settings instructions and base URL display.
  - Any docs or in-app copy that reference the claim URL.
- **Canonical claim URL:**  
  `https://campusmobilityproject.com/claim/<token-uuid>`
- No need for env override in the first version. Later, if staging or multi-tenant domains are required, add `NEXT_PUBLIC_CLAIM_BASE_URL` defaulting to `https://campusmobilityproject.com`.

---

## 9. Summary

- **Mission:** Fleet is a first-class tab; build it to the **same robustness as Campaigns and Deal Desk** (server actions, audit, pagination, validation, error/loading states). See §4 (robustness parity) and VULTURE-style checklist.
- **Auditability:** $25 + interest is digitally tethered to the token URL; chain of record is token_id → response → payout. Fleet operations (assign campaign, assign org, export URLs) must be auditable via a token/fleet audit log; Set Campaign and Transfer Fleet (and future Export) must write to it.
- **Tight management:** URLs and IDs are restricted to authorized Command Center users; claim URL is hardcoded to campusmobilityproject.com; optional signed URLs for unguessable links.
- **Fleet tab needs:** listTokens server action (pagination, filters, count); Claim URL per token (copy); Export claim URLs (gated + audited); Set Campaign and Transfer Fleet as server actions with audit and batch limits; Fleet audit trail view ("Recent activity"); loading/error/empty states; no unbounded list load.
- **Settings support for fleet:** Token management instructions (one-off + bulk 1000+); hardcoded base URL display (campusmobilityproject.com); note that fleet audit is in Fleet tab. No fleet operations in Settings.
- **Domain:** Hardcode **https://campusmobilityproject.com** (Offbeat Options); use it everywhere claim URLs are generated or displayed.
- **500 avoidance:** Validate at boundaries (e.g. UUID); try/catch in server code; never throw in Server Component render—return safe UI or structured errors; server actions return `{ success, error }`; follow the claim page pattern for new fleet/claim/export code so we avoid the generic production error message and 500s.

This keeps planning aligned with the codebase and sets the bar for auditable, tight token and URL management, **Fleet robustness parity with Campaigns and Deal Desk**, and robust error handling before implementation.
