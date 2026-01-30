# Fleet UI/UX: List vs Detail Page and RBAC

This doc clarifies what belongs in the **Fleet tab (list view)** vs the **Fleet Token Detail page** (`/fleet/[id]`), and how **RBAC** affects what is shown. It supports VULTURE Fleet scope and consistent behavior across list and detail.

---

## 1. Fleet tab (list view)

**Purpose:** High-level overview, filtering, search, bulk actions, and quick per-row actions. Optimized for many tokens with server-side pagination and filters.

**What belongs in the list (and is there today):**

- **Identification:** Checkbox, Organization name (when SUPER_ADMIN or Auditor), truncated Asset ID (e.g. `...bd380a11`), Coordinates, Active campaign name, Balance, Status.
- **Filtering and search:** Campaign filter, status filter, search by asset ID (UUID). Org scope is implicit: ORG_ADMIN sees only their org; SUPER_ADMIN can use GLOBAL or TENANT (selected org).
- **Bulk actions:** Assign campaign, transfer fleet (SUPER_ADMIN only), export URLs, refresh list. All gated and audited.
- **Per-row actions:** Copy URL (SUPER_ADMIN only), Copy ID. Reload $25 (SUPER_ADMIN only, for redeemed tokens).
- **Performance:** Server-side pagination and count, no unbounded select. List stays responsive at 10k–500k tokens.

**What should *not* live only in the list:**

- Full UUID (use detail page).
- Full claim URL (sensitive; list shows copy only for SUPER_ADMIN; full display on detail when allowed).
- Token-specific audit trail, timestamps, or linked response — use the detail page.

---

## 2. Fleet Token Detail page (`/fleet/[id]`)

**Purpose:** Single-asset view: full identifier, status, org, campaign, balance, coordinates, and (when allowed) claim URL. Optional future: token audit slice, link to response, single-token actions.

**What is there today:**

- **Core:** Full Asset ID (with copy), Status, Organization name, Active campaign name, Balance, Coordinates.
- **Claim URL:** Shown only when the viewer is SUPER_ADMIN (server returns `claim_url` only when `auth.organizationId === null`). Copy button when shown.
- **Navigation:** “Back to Fleet” → dashboard. Loading, not-found, and error states with clear messaging.

**What can be added later (within Fleet scope):**

- **Claim URL for ORG_ADMIN:** Remain restricted; show a “Claim URL: (restricted)” row so the field is visible but not the value (consistent with export redaction).
- **Token-scoped audit:** A short list of `fleet_audit_log` entries for this token (event type, actor, at). Requires an action that returns events filtered by token ID.
- **Link to response:** If the token is redeemed, a link to `app/responses/[id]` for the response tied to this `token_id` (read-only audit).
- **Single-token actions:** Reload, assign campaign, transfer — same rules as bulk (SUPER_ADMIN for reload/transfer; SUPER_ADMIN or org-scoped ORG_ADMIN for assign). Optional UX improvement, not a scope change.

**What stays out of the detail page:**

- Bulk operations (they stay in the list).
- Creation or deletion of tokens (handled in Settings / fleet create flow, not asset detail).

---

## 3. RBAC and what is shown

**Auth and scope:** Both the Fleet list and the detail page use the same access model: `requireFleetAccess()` (SUPER_ADMIN or ORG_ADMIN with `fleet_write`). ORG_ADMIN is restricted to tokens where `organization_id` equals their `dataScopeOrgId` (their org). SUPER_ADMIN has no org filter (`organizationId === null`).

### 3.1 Fleet list

- **SUPER_ADMIN:** Sees all tokens (or tenant subset when in TENANT view). Organization column shown. Can copy URL, reload, transfer fleet, export URLs.
- **ORG_ADMIN:** Sees only tokens in their org. No organization column (redundant). Can assign campaign and export within org; “Copy URL” is hidden; export redacts claim URLs to `(restricted)`.
- **Auditor:** Read-only; organization column shown; no write actions.

### 3.2 Fleet Token Detail page

- **Access:** `getToken(tokenId)` enforces the same rules:
  - If the user is ORG_ADMIN and the token’s `organization_id` ≠ their org, the server returns “Token not found.” (no leak of other orgs’ data).
  - Invalid or missing token ID → “Invalid token ID.” or “Token not found.”
- **Claim URL:**
  - **SUPER_ADMIN:** Server includes `claim_url` in the token object; detail page shows the full URL and copy button.
  - **ORG_ADMIN:** Server does *not* include `claim_url`; detail page does not show the URL. Optionally show “Claim URL: (restricted)” for consistency with export (see above).
- **All other fields:** Status, organization name, campaign name, balance, coordinates are visible to any user who can see the token (i.e. SUPER_ADMIN for any token, ORG_ADMIN only for tokens in their org).

### 3.3 Implementation notes

- **List:** `listTokens` is called with `organizationId: dataScopeOrgId ?? undefined`. Dashboard passes `dataScopeOrgId` from `dashboard-context` (org selector for SUPER_ADMIN, profile org for ORG_ADMIN).
- **Detail:** `getToken(tokenId)` uses `requireFleetAccess()` then, if `auth.organizationId != null`, checks `row.organization_id === auth.organizationId` and returns “Token not found.” if they differ. Claim URL is added only when `auth.organizationId === null` (SUPER_ADMIN).
- No client-side Supabase writes to `tokens` or `fleet_audit_log`; all mutations go through server actions with the same auth/scope checks.

---

## 4. Summary

| Location        | Purpose              | Key RBAC effect                                                                 |
|----------------|----------------------|----------------------------------------------------------------------------------|
| Fleet tab      | List, filter, bulk   | ORG_ADMIN: org-scoped list; no Copy URL; export redacts claim URLs.              |
| Fleet detail   | Single asset, full ID| ORG_ADMIN: only tokens in their org; no claim URL (optionally “(restricted)”).   |

Keeping list vs detail and RBAC aligned this way keeps the Fleet tab and detail page consistent, demo-safe, and ready for future additions (token audit, response link, single-token actions) without scope creep.
