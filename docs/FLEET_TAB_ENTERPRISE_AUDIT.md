# Fleet tab enterprise-grade audit (vulture)

**Verdict:** Solid foundation (RBAC, audit, validation, token logic). Not yet fully enterprise-grade: missing modal UX, selection UX, and a few polish items.

---

## What is already enterprise-grade

| Area | Status |
|------|--------|
| **RBAC** | requireFleetAccess (SUPER_ADMIN or ORG_ADMIN + fleet_write); org-scoped list; SuperAdmin-only for create/delete/reload/fund/remove funds. |
| **Audit** | fleet_audit_log for token_created, token_deleted, token_funded, tokens_funded_bulk, token_reloaded, funds_removed, campaign_assigned, organization_assigned, url_exported; actor_user_id + payload. |
| **Validation** | UUIDs (isUuidLike); batch limits (200 bulk, 100 create); pageSize 10–200; search query capped 500 chars; non-UUID search returns empty (no injection). |
| **Pagination** | Page, pageSize, total capped at 500k; Previous/Next disabled when at bounds; loading disables pagination. |
| **Loading / empty / error** | "Loading fleet…", empty state "No assets in this scope", fleetError with Retry. |
| **Token state logic** | Redeem blocked when balance $0; warning when funding redeemed token (single + bulk); reload sets active + reloaded_at + first_redeemer in asset detail. |
| **Accessibility (partial)** | role="dialog", aria-modal="true", aria-labelledby on modal; aria-label on page size, filters, select-all and per-row checkboxes; focus:ring on inputs/buttons. |
| **Concurrent actions** | assignCampaignLoading, bulkLoadSubmitting, reloadingTokenId disable buttons during mutation. |

---

## Gaps (addressed)

| Gap | Status |
|-----|--------|
| **Modal: Escape / backdrop close** | Done. Asset detail and confirm modals close on Escape and backdrop click. |
| **Modal: focus trap** | Done. Asset detail modal traps Tab/Shift+Tab and focuses first focusable on open. |
| **Reload button label** | Done. Label is "Reload" with tooltip. |
| **"Clear selection" / selection count** | Done. "N selected" and "Clear selection" when any row selected. |
| **Selection is page-scoped** | Done. Checkbox label is "Select all on this page"; selection applies only to current page (no cross-page select at 500k). |
| **In-app confirmation modals** | Done. Transfer Fleet and bulk Load funds (when some redeemed) use in-app modal with Confirm/Cancel; Escape and backdrop close. |
| **Column sort** | Done. Status and Balance columns are sortable (click header toggles asc/desc); listTokens accepts orderBy (id \| status \| balance \| created_at) and orderDir. |
| **Sticky table header** | Done. thead sticky with backdrop-blur. |
| **Export success feedback** | Done. "Exported N URL(s)." message, auto-clears after 4s. |
| **Pagination aria-labels** | Done. Previous/Next have aria-label; page indicator has aria-live="polite". |
