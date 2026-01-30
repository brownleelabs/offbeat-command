# BENJI API Integration & Tokens Available to Mint

This doc describes what we will tie to the BENJI API once connected, the math for **tokens available to mint**, and what we can build **now** while waiting for the API. See also **benji_integration.md** for asset definition, intraday yield, and wallet architecture.

---

## 1. Confirmation: Tokens Available to Mint

**Yes.** Once we connect to the BENJI API we can calculate exactly how many tokens are available to mint at any given time using:

- **Interest rate** (e.g. 7-day effective yield from BENJI)
- **Principal balance** (real-time AUM or equivalent from BENJI)
- **The yield split** (63/12/25: student / operator / protection, per OYE; see **economic_engine.md** and Deal Desk)

The student share of yield funds token liquidity. So:

- **Student share of yield** = principal × (annual yield rate) × studentShare  
  (e.g. monthly: principal × (rate/12) × studentShare)
- **Tokens available to mint** = student share of yield ÷ token value ($25)

So the math is there: we will use BENJI’s principal and yield to compute the student portion, then divide by $25 to get a token count. Economic zones (Normal / Steady / Efficient / Freeze) can adjust the split (e.g. operator waived in low yield); the same formula applies with the effective student share for the current zone.

---

## 2. What We Tie to the BENJI API (Planning)

| Data from BENJI | Use in Command Center |
|-----------------|------------------------|
| **7-day effective yield** | Current economic zone; yield rate for tokens-available and Deal Desk assumptions |
| **Real-time AUM / principal** | Principal balance for tokens-available calculation; optional display |
| **Transaction history** | Audit trails; reconciliation with token funding / removal |
| **Yield / waterfall** | Confirm 63/12/25 (or zone-adjusted) split for student share |

When the API is available we will:

1. Ingest yield and principal (per org or global, as per product).
2. Compute **tokens available to mint** = (principal × yield × studentShare) / TOKEN_VALUE, using the appropriate period (e.g. monthly or daily) and zone.
3. Surface that number in the Map tab (“Tokens Available to Mint”) and anywhere else we show mint capacity.
4. Optionally drive Deal Desk “Current BENJI Yield Rate” and system status from the same feed.

---

## 3. Math We Can Implement Now (No API)

We can implement the **pure math** and **types** now so that once the API returns principal and yield, we just plug them in.

- **Constants:** `TOKEN_VALUE = 25`, student/operator/protection shares from `getYieldWaterfallShares(yieldRatePercent)` (Deal Desk / economic_engine).
- **Formula (e.g. monthly):**  
  `tokensAvailableToMint = (principal * (annualYieldRateDecimal / 12) * studentShare) / TOKEN_VALUE`  
  Use the student share for the current yield zone (63% in Normal; 100% in Efficient when operator waived, etc.).
- **Placeholder:** Until the API is connected, “Tokens Available to Mint” can show `—` or a stub; the Map (and any other UI) already has the slot for the value.

Implemented:

- **Shared util** `lib/benji-math.ts`: `tokensAvailableToMint(principal, annualYieldRatePercent, studentShare, periodMonths?)` and `TOKEN_VALUE_USD = 25`. Use this when BENJI returns principal and yield.
- **getMapAnalytics** (or equivalent): when we have BENJI data, pass principal + yield + share into that function and return `tokensAvailableToMint` for the Map tab.
- **Types:** e.g. `BENJIQuote { principal: number; yieldRate: number; studentShare: number; tokensAvailableToMint: number }` for the day we add an API client.

---

## 4. Build Now Checklist (While Waiting for API)

- [x] **Map tab:** “Tokens Available to Mint” row (shows `—` until API).
- [x] **Shared math:** `lib/benji-math.ts` — `tokensAvailableToMint(principal, annualYieldPercent, studentShare)` (and optional unit tests later).
- [ ] **Types:** Optional `BENJIQuote` (or similar) for API response shape.
- [ ] **BENJI client stub:** Optional module that returns `null` or mock data; swap for real API later.
- [ ] **Docs:** This file + **benji_integration.md** as the single place to plan API fields and UI tie-ins.

---

## 5. References

- **benji_integration.md** — Asset (FOBXX/BENJI), intraday yield, data ingestion list, wallet architecture.
- **economic_engine.md** — OYE formula, 63/12/25 split, economic zones.
- **Deal Desk** — `getYieldWaterfallShares(interestRate)`, yield zones, K_eff.
- **Map tab** — Analytics panel “Tokens Available to Mint”; will wire to BENJI once API is live.
