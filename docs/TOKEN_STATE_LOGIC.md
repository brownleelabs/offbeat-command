# Token state logic (vulture rules)

This doc describes the **invariants and code paths** for token state changes. Use it to audit that redemption, funding, and reload all track correctly.

---

## Token state model

- **status**: `active` | `found`
  - `active`: token is in the field; not yet redeemed (or was reloaded).
  - `found`: token was redeemed (student submitted claim).
- **balance**: numeric, default 0. Must be > 0 for a student to redeem.
- **redeemed_at**: set when claim is submitted; cleared when token is reloaded.
- **reloaded_at**: set when a redeemed token is put back to active (SUPER_ADMIN reload); kept for audit.
- **responses**: one row per token (unique `token_id`). First response (by `created_at`) is the “first redeemer” for that asset.

---

## Code paths and invariants

### 1. Student redemption (claim)

- **Entry**: Claim page `/claim/[id]` → `ClaimForm` → `submitClaim` (server action).
- **Block $0 balance**
  - **Claim page**: If token exists but `balance` is null or ≤ 0, render “NO VALUE” and do **not** show the claim form.
  - **submitClaim**: Fetches token with `balance`; if balance is null or ≤ 0, returns `{ success: false, error: 'This token has no value and cannot be redeemed.' }`.
- **Block double-claim**: If `status === 'found'`, return “This token has already been claimed.”
- **On success**: Insert `responses` row; update token `status = 'found'`, `redeemed_at = now()`.

### 2. Load funds (single token)

- **Entry**: Fleet asset detail (page or dashboard modal) → “Load funds” → `loadFundsToToken(tokenId, amount)`.
- **Warning when already redeemed**: If token `status === 'found'`, UI must show a confirmation: “This token has already been redeemed. Adding funds will not change who redeemed it. Add funds anyway?” Only then call the action.
- **Server**: Validates amount $1–$25; updates `balance`; logs `token_funded`.

### 3. Load funds (bulk)

- **Entry**: Dashboard Fleet tab → select tokens → “Load funds to selected” → `loadFundsToTokens(tokenIds, amount)`.
- **Warning when any selected is redeemed**: Before calling the action, count how many selected tokens have `status === 'found'`. If count > 0, show: “N of the selected token(s) have already been redeemed. Add funds to all anyway?” Only then call the action.
- **Server**: Validates amount $1–$25 and batch size; updates `balance` for all; logs `tokens_funded_bulk`.

### 4. Reload token (put redeemed back to active)

- **Entry**: Dashboard Fleet tab / asset detail → “Reload $25” (or reload action) → `reloadTokens(tokenIds)`.
- **Effect**: Only tokens with `status === 'found'` are updated. Sets `status = 'active'`, `redeemed_at = null`, `reloaded_at = now()`.
- **UI**: After reload, token shows as **active** again (not “Redeemed”). In asset detail, system of record still shows:
  - **Reloaded at**: from `tokens.reloaded_at`.
  - **First redeemed by**: from the first `responses` row for this token (by `created_at`), so “who got the first redeem” is always visible even after reload.

### 5. Remove funds

- **Entry**: Settings → “Remove funds from token” → `removeFundsFromToken(tokenId)`.
- **Server**: Requires `balance > 0`; sets `balance = 0`; logs `funds_removed`.

### 6. Delete token

- **Server**: Allowed only when `balance === 0`. If token has responses, deletion does not remove them (e.g. `ON DELETE SET NULL` on `responses.token_id` for audit).

---

## Files to check when auditing

| Concern              | Where to look |
|----------------------|---------------|
| Block redeem when $0 | `app/actions.ts` (submitClaim: balance select + check), `app/claim/[id]/page.tsx` (getTokenForClaim: balance in select; NO VALUE screen) |
| Warning fund redeemed | `app/fleet/[id]/page.tsx` (handleLoadFunds confirm), `app/dashboard-client.tsx` (Fleet detail modal confirm, bulk Load funds confirm) |
| Reload sets active    | `app/fleet/fleet-actions.ts` (reloadTokens: status, redeemed_at, reloaded_at) |
| First redeemer / reloaded at | `app/fleet/fleet-actions.ts` (getToken: first_redeemer when status active, reloaded_at); Fleet asset detail page and dashboard modal (display) |

---

## Summary

- **Redemption**: Blocked when balance is $0 (claim page + submitClaim).
- **Funding redeemed token**: Allowed only after explicit warning (single and bulk).
- **Reload**: Token shows active again; `reloaded_at` and first redeemer (from `responses`) remain visible in asset detail.
