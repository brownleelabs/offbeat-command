# Map Tab MVP Plan — Robustness & Visual Strength

**Goal:** Bring the Map tab to the same level of robustness as Fleet, Campaigns, and Settings so it is **MVP / live-demo ready**, and lean into Mapbox to make token updates **visually strong** (real-time markers, clear states, optional motion).

---

## 1. Current State Summary

### What the Map Tab Does Today

| Area | Status |
|------|--------|
| **Data** | `listTokensForMap(orgId)` — same auth/scoping as Fleet (`requireFleetAccess`), limit 500 tokens. Returns `id, lat, lng, status, organization_id`. |
| **Realtime** | Supabase channel `map-live`: **UPDATE** on `tokens` (status/lat/lng) and **INSERT** on `responses` (claim submitted). UPDATEs merge into local state; new **tokens** (INSERT on `tokens`) are **not** subscribed — new assets appear only after refresh. |
| **RBAC** | Map access is not tab-gated by role; **which tokens** are shown is org-scoped (SUPER_ADMIN global, ORG_ADMIN/AUDITOR by org). **Reset Simulation** button is the only permission: `canReset` from `effectivePermissions.mapReset` (SUPER_ADMIN or role has `map_reset`). |
| **Reset** | `resetDemo(orgId)` sets all tokens in scope to `status: 'active'`. **Server does not check `map_reset`** — only the UI hides the button when the user lacks permission. |
| **UI** | Mapbox GL (react-map-gl), light style. Markers: active = primary + pulse; found = muted. Overlay: "Command Center" (Total Yield Disbursed, Active Assets), "Live Feed" (last 3 events). Reset button bottom-right. |
| **Empty / Error** | No explicit **loading** state for initial fetch. On `listTokensForMap` failure, `tokens` is set to `[]` with no error message or Retry. No **empty state** copy when `tokens.length === 0` (e.g. "No assets in this scope"). |
| **Section context** | No section header/legend above the map (Fleet has "Fleet Management" + short description + optional info tooltip). Map tab is just map + overlays. |
| **Accessibility** | Reset button has no `aria-label`. Overlay panels have headings but no live region for "Live Feed" updates. No map legend for "active vs found." |

### What’s Already Solid

- Same auth/scoping as Fleet (`listTokensForMap` uses `requireFleetAccess`).
- Realtime **UPDATE** on tokens (status flip to `found`) and **INSERT** on responses (claim log).
- Mapbox token from env or `/api/mapbox-token`; fallback message when no token.
- Container ready check (ResizeObserver) before showing map.
- Clear visual distinction for active vs found markers (primary pulse vs muted).

---

## 2. Gaps vs Other Tabs (Robustness)

Aligned with **Fleet / Campaigns / Settings** patterns:

| Gap | Fleet/Campaigns pattern | Map today |
|-----|-------------------------|-----------|
| **Loading state** | "Loading fleet…" / "Loading campaigns…" with disabled controls | No loading; tokens can appear after a delay with no feedback |
| **Error state** | `fleetError` / `loadError` with **Retry** button | On failure, tokens = [] and no message or Retry |
| **Empty state** | "No assets in this scope" / "No campaigns yet." | No copy when tokens.length === 0 |
| **Server-side permission** | Fleet write / campaign write enforced in actions | `resetDemo` does not check `map_reset`; button is only hidden in UI |
| **Realtime completeness** | N/A (Fleet has realtime for token updates) | **INSERT** on `tokens` not subscribed — new assets from Fleet don’t appear until refresh |
| **Section header / legend** | Fleet: "Fleet Management" + description + (optional) terms tooltip | No header; no legend for marker meaning |
| **Accessibility** | aria-labels on filters, buttons, pagination; focus ring | Reset button no aria-label; Live Feed not announced; no legend |
| **Concurrent action feedback** | Buttons disabled with "…ing" label during mutation | Reset shows "Reloading Grid..." and disables — good; no success/error toast after reset |

---

## 3. Visual Strength Opportunities (Mapbox)

The map can be **visually strong** when tokens update:

| Opportunity | Description |
|-------------|-------------|
| **Status change animation** | When a token goes `active` → `found`, briefly highlight (e.g. ring, color flash, or small scale) so the change is obvious. |
| **New token appearance** | Once we subscribe to **INSERT** on `tokens`, animate new markers in (e.g. fade-in or short pop) so "new asset added" is visible. |
| **Fit bounds / "Show all"** | Button or auto behavior to fit all markers in view (useful when switching org or after load). |
| **Cluster at low zoom (optional)** | If token count grows, consider clustering at low zoom for performance and clarity; can be Phase 2. |
| **Legend** | Small legend: "Active asset" (primary pulse), "Found / claimed" (muted) — matches Fleet vocabulary. |
| **Live Feed as live region** | `aria-live="polite"` on the Live Feed container so new lines are announced. |

---

## 4. MVP Readiness Plan

### Phase A — Robustness (parity with other tabs)

1. **Loading state**
   - Add `mapLoading` (or equivalent) in `MapView`; set true before `listTokensForMap`, false after.
   - While loading: show a clear "Loading map…" overlay or message (and optionally dim/disable map interaction).
2. **Error state**
   - If `listTokensForMap` returns `success: false`, set `mapError` (e.g. `res.error`) and show a concise message + **Retry** button (call `fetchTokens()` again).
   - On Retry, clear error and show loading again.
3. **Empty state**
   - When `!mapLoading && !mapError && tokens.length === 0`, show a short message (e.g. "No assets in this scope. Add tokens in Fleet or switch organization.") — optionally in overlay or above map.
4. **Reset: server-side permission**
   - In `resetDemo` (or a thin wrapper): require map access + `map_reset` (e.g. get profile/role and check permission, or call a shared "requireMapReset" that reads `role_permissions`). If not allowed, return `{ success: false, error: 'Not allowed.' }`.
   - Keep `canReset` in UI so button is hidden when user lacks permission; server then enforces.
5. **Realtime: INSERT on tokens**
   - In `map-live` channel, add `.on("postgres_changes", { event: "INSERT", schema: "public", table: "tokens" }, ...)`.
   - Filter by `organization_id` when `orgId != null`; append new token to `tokens` state (and optionally push a Live Feed line: "Asset ...xxxx added").
   - Ensures new tokens created in Fleet appear on the map without refresh.
6. **Section header / legend**
   - In dashboard, when `activeTab === "map"`, render a small section above the map (or as first line of overlay): title "Map" or "Live Map" + one-line description (e.g. "Assets by location. Active = unclaimed; Found = claimed.").
   - Add a compact **legend**: Active (primary pulse), Found (muted) — same vocabulary as Fleet.
7. **Accessibility**
   - Reset button: `aria-label="Reset simulation (set all assets in scope back to active)"`.
   - Live Feed container: `aria-live="polite"` and optionally `aria-label="Live feed of asset and claim events"`.
   - Legend: ensure markers/colors are described in text (for screen readers).

### Phase B — Visual Polish (make updates pop)

8. **Marker transition on status change**
   - When a token in state flips from `active` to `found`, give that marker a brief visual transition (e.g. CSS transition on class change, or a one-off "just found" class that triggers a ring/scale animation and then reverts to normal "found" style).
9. **New token entrance**
   - When adding a token from INSERT, render it with a short entrance animation (e.g. `animate-in` / fade-in, or small scale-up) so new assets are noticeable.
10. **Fit bounds (optional)**
    - "Fit all" or "Show all assets" button that computes bounding box of current `tokens` and calls `map.getMap().fitBounds(...)` with padding. Useful after load or org switch.
11. **Reset feedback**
    - After successful reset, show a short success message (e.g. "Simulation reset.") that auto-clears after 2–3s, similar to Fleet export success.

### Phase C — Optional (post-MVP)

- Clustering at low zoom for large token counts.
- Map style selector (light/dark/streets) if product wants it.
- Permalink or share view state (center/zoom) for demos.

---

## 5. Checklist (MVP-Ready Map Tab)

Use this to track parity with other tabs and visual clarity:

| Item | Status |
|------|--------|
| Loading state ("Loading map…") | ⬜ |
| Error state + Retry | ⬜ |
| Empty state copy | ⬜ |
| Reset: server-side `map_reset` check | ⬜ |
| Realtime: INSERT on `tokens` | ⬜ |
| Section header + one-line description | ⬜ |
| Legend (Active / Found) | ⬜ |
| Reset button aria-label | ⬜ |
| Live Feed aria-live (and optional aria-label) | ⬜ |
| Marker transition on active→found | ⬜ |
| New token entrance animation | ⬜ |
| Reset success feedback (toast/message) | ⬜ |
| Fit bounds button (optional) | ⬜ |

---

## 6. Files to Touch

| File | Changes |
|------|--------|
| `components/map-view.tsx` | Loading/error/empty state; realtime INSERT; legend; aria-labels and aria-live; marker transition and new-token animation; optional fit bounds. |
| `app/actions.ts` | `resetDemo`: add permission check (e.g. require map_reset via profile/role_permissions); return 403-style error if not allowed. |
| `app/dashboard-client.tsx` | When `activeTab === "map"`, add section header (title + description) above the map container; optionally pass a short "mapLegend" or rely on MapView’s built-in legend. |

---

## 7. Summary

- **Current state:** Map has correct scoping, realtime updates for token **status** and claim events, and a Reset button gated only in the UI. It lacks loading/error/empty states, server-side reset permission, realtime **new tokens**, section context, legend, and some accessibility and visual polish.
- **Phase A** brings **robustness** in line with Fleet/Campaigns: loading, error+Retry, empty state, server-side reset permission, realtime INSERT for tokens, header+legend, and accessibility.
- **Phase B** makes the map **visually strong**: marker transition on found, new-token entrance, reset success feedback, and optional fit bounds.
- Delivering Phase A + the first three items of Phase B (marker transition, new-token animation, reset feedback) is enough to call the Map tab **MVP ready** and demo-ready, with room to add fit bounds and clustering later.
