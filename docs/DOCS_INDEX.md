# Docs Index — MVP Handoff

Quick map of `docs/` for future iterations (e.g. first customer build). **No code or logic changes** when doing doc polish; only update text so it reflects the current MVP.

---

## Start here (canonical)

| Doc | Purpose |
|-----|---------|
| **README.md** (root) | Getting started, env vars, claim domain, production link to PRODUCTION_READY. |
| **docs/PRODUCTION_READY.md** | Go-live checklist: env vars, migrations (incl. `site_settings`), post-deploy checks. |
| **docs/SYSTEM_ARCHITECTURE.md** | One system: routes, auth (proxy + auth-server), validation, module boundaries, RLS, audit, error handling. |
| **docs/UI_VOCABULARY.md** | Dashboard structure: View Mode Banner, Nav Bar, Executive Stats Banner, tabs (Map, Fleet, Campaigns, Settings), Redemption success message. |
| **docs/OFFBEAT_DESIGN_SYSTEM.md** | Design system: Kinetic Trust, color dictionary, Z-pattern, component rules (cards, inputs, glows). |
| **docs/economic_engine.md** | OYE: TDV formula, Survival Stack (25% / 63% / 12%), Economic Operating Zones, variable issuance. Align with `lib/benji-math.ts` and Deal Desk formulas in `app/deal-desk/page.tsx`. |

---

## Planning / implementation notes (reference)

| Doc | Purpose |
|-----|---------|
| **DEMO_PRODUCTION_POLISH_PLAN.md** | Phases 0–5 (redemption message, hygiene, claim UX, dashboard, performance, security). All implemented; use as history. |
| **PRODUCTION_READINESS_REVIEW.md** | Older audit; gaps listed there have been fixed. Treat as historical; PRODUCTION_READY.md is current. |
| **VULTURE_*.md** (Map, Campaigns, Fleet) | Inspection/implementation notes for Map, Campaigns, Fleet. Useful context; not the only source of truth. |
| **MAP_TAB_MVP_PLAN.md**, **TOKEN_STATE_LOGIC.md**, **TOKEN_AND_DOMAIN_*.**, **FLEET_*.**, **CAMPAIGNS_*.** | Planning and audit docs for specific features. Reference when extending those areas. |

---

## Other (domain / compliance / integrations)

| Doc | Purpose |
|-----|---------|
| **BENJI.md**, **benji_integration.md** | BENJI integration and token math; see also `lib/benji-math.ts`. |
| **governance_compliance.md** | Governance/compliance context. |
| **ORGANIZATIONS_SETUP.md** | Org/school setup. |
| **LANDING_PAGE_REDESIGN_PLAN.md**, **DASHBOARD_DESIGN_ANALYSIS.md** | Design/UX notes. |
| **SETTINGS_PLANNING_AGENT_SPEC.txt**, **CAMPAIGNS_PLANNING_AGENT_SPEC.txt**, **NOTEBOOKLLM_*.** | Agent/spec prompts; reference only. |

---

## Doc polish (when coming back)

When you return to build the MVP into the product (e.g. first customer):

1. **Refresh canonical docs** so they match the code: SYSTEM_ARCHITECTURE (routes, site_settings, claim flow), OFFBEAT_DESIGN_SYSTEM (components in use), economic_engine (formulas vs Deal Desk / benji-math), UI_VOCABULARY (line numbers or sections if moved).
2. **Mark historical docs** (e.g. PRODUCTION_READINESS_REVIEW) as “Superseded by PRODUCTION_READY” so no one treats old gaps as open.
3. **Single source of truth**: PRODUCTION_READY.md = go-live; SYSTEM_ARCHITECTURE.md = architecture; economic_engine.md + benji-math + Deal Desk = pricing/yield logic.

---

## Document handoff prompt (for future sessions)

Copy-paste this into the AI when you return to polish docs (no code or logic changes):

```
We are wrapping up the MVP; the app is production-ready and we are not changing code or logic. I need a documentation handoff pass only.

1. Read docs/DOCS_INDEX.md to understand which docs are canonical vs historical.
2. Update canonical docs so they match the current codebase:
   - SYSTEM_ARCHITECTURE.md: Ensure routes, auth, site_settings, claim flow, and module boundaries are accurate. Add site_settings and configurable redemption success message if missing.
   - OFFBEAT_DESIGN_SYSTEM.md: Align with UI_VOCABULARY and actual component patterns (e.g. Link not <a>, error boundary). Add any missing rules we follow.
   - economic_engine.md: Align formulas and zones with lib/benji-math.ts and the Deal Desk formulas in app/deal-desk/page.tsx (TDV, yield waterfall, K_eff, zones). Document the actual constants and curves used in code.
   - UI_VOCABULARY.md: Refresh any stale line numbers or section references; ensure Settings (Redemption success message), tabs, and Stats Banner are accurately described.
3. Mark historical/audit docs: In PRODUCTION_READINESS_REVIEW.md add a short note at the top that all listed gaps have been fixed and PRODUCTION_READY.md is the current go-live checklist.
4. Ensure PRODUCTION_READY.md and README.md production section are still accurate (env vars, migrations, post-deploy steps).
5. Do not modify app code, components, or server logic. Only create or edit markdown/text in docs/ and README.md.
```
