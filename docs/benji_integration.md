# Franklin Templeton (BENJI) Technical Integration

**Source of Truth:** BENJI Prospectus & Platform Overview.

## 1. Asset Definition
- **Asset:** Franklin OnChain U.S. Government Money Fund (**FOBXX**).
- **Token:** BENJI.
- **Yield:** Accrues daily, distributed as new tokens.

## 2. Intraday Yield Feature
BENJI supports **Intraday Yield**, enabling precise accrual for peer-to-peer transfers.
- **Usage:** Allows the OYE to calculate yield down to the second for "Just-in-Time" rewards.

## 3. Data Ingestion
The Offbeat Dashboard must ingest the following from the Benji Institutional API:
- **7-Day Effective Yield:** To determine the current **Economic Operating Zone**.
- **Real-time AUM:** To calculate the daily "Waterfall" distribution (63/25/12).
- **Transaction History:** For audit trails.

## 4. Wallet Architecture
- **Model:** Hierarchical Deterministic (HD) structure or Sub-Account architecture.
- **Owner:** University Master Wallet.
- **Manager:** Offbeat Operator Wallet (whitelisted for management).

## 5. Mock Mode
Set `BENJI_MOCK_MODE=true` in `.env` to test the Offbeat Yield Engine without live BENJI keys. In Mock Mode:
- `lib/benji-client.ts` returns deterministic fake data for `getWalletHolding` / `getWalletYield` (e.g. `currentEstAmount: 50000` so `Math.floor(newYield/25)` is > 0).
- `transferCreate` and `withdrawalCreate` return mock IDs and status `COMPLETE` without calling the GraphQL API.
- No `BENJI_GRAPHQL_URL` or `BENJI_API_KEY` required. Use for local development and CI until live keys are provisioned.

Phase 2 adds the BENJI client (Mock + live) in `lib/benji-client.ts` and token state-machine helpers in `lib/token-logic.ts`: `canTransition(from, to)` and `requireActiveTether(token)` for valid 6-state transitions and the ACTIVE tether invariant (used by claim and fleet-actions).

## 6. 6-State Token Model (Ghost-in-the-Shell)
Tokens move through six operational states; the Fleet dashboard shows **Ghost** (MINTED), **Shell** (DORMANT), and **Live** (ACTIVE) counts.

| State | Role | Description |
|-------|------|-------------|
| MINTED | The Ghost | Digital value from yield; asset_uuid set, nfc_uid null. |
| DORMANT | The Shell | Physical chip deployed but empty ($0); nfc_uid set, asset_uuid null. |
| ACTIVE | The Tether | Live: asset merged with shell; both nfc_uid and asset_uuid required ($25). |
| PENDING_SETTLEMENT | The Lock | Student tapped; value locked while Venmo payout in progress. |
| REDEEMED | The Burn | Payout complete; asset_uuid archived (redemption_history), balance 0. |
| VOID | The Kill | Hardware lost/stolen/destroyed; superadmins delete these assets (not shown in Fleet counts/filter). |

- **Rain Barrel:** Cron `GET /api/cron/yield-distribution` (CRON_SECRET) uses BENJI yield to activate DORMANT tokens (assign asset_uuid, balance 25). Schedule in `vercel.json` (e.g. `0 14 * * *` = daily 14:00 UTC).
- **Slow Rail:** The same cron runs `lib/settlement-engine.ts` after minting: queries REDEEMED tokens in last 24h, sums value, calls BENJI `transferCreate` to move value to Offbeat Operations; if `VENMO_BUFFER_BALANCE` is under 50k, calls `withdrawalCreate` to refill (USDC path).
- **Claim flow (Phase 4):** Claim page requires token status ACTIVE; optional `signature` from URL (NFC SUN). When `REQUIRE_SUN_SIGNATURE=true`, claim is rejected without a valid signature. submitClaim transitions token to PENDING_SETTLEMENT, inserts response, calls `executePayout` (Venmo stub or live API); payout performs Burn rule (redemption_history + token → REDEEMED, balance 0). Claim form shows "Processing Reward..." during submit; PENDING_SETTLEMENT shows "Processing your reward" on refresh.

- **Fleet (Phase 5):** Fleet tab shows **Asset ID Status Count:** Minted, Dormant, Active, Pending, Redeemed (Void omitted; superadmins delete voided assets). createTokens inserts shells with status DORMANT. Status filter and list use the 5 displayed states. Asset detail modal uses same labels. Reload is **not** in Fleet; superadmin uses **Settings** (Reload token + Remove funds) after entering asset ID. **Realtime:** Supabase `postgres_changes` on `tokens` (UPDATE, INSERT, DELETE) and `responses` (INSERT) keep Fleet list and status counts in sync when the Fleet tab is active; debounced 400ms to avoid hammering on rapid events.
- **Reload (Settings):** Superadmin-only. In Settings, **Reload token** (asset ID → REDEEMED → DORMANT) and **Remove funds** (asset ID → balance $0) live together. Most tokens end life at REDEEMED; reload is an edge case. **DORMANT** is required for reload (post-reload state) and for createTokens (new shells); Remove funds currently leaves status unchanged (balance 0 only).