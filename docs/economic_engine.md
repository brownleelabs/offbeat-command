# Offbeat Yield Engine (OYE) Master Logic

[cite_start]**Source of Truth:** Offbeat Yield Engine (OYE) v5.0 [cite: 10237, 10239]

## 1. The Core Pricing Formula (Total Deal Value)
To determine the endowment capital required ($TDV$), use this formula:

$$TDV = \frac{S \times (R_{pm} \times 9) \times \$25}{K_{eff} \times r_{deal}}$$

**Variables:**
- [cite_start]**S (Active Scale):** Target number of student participants (e.g., 20% of total enrollment). [cite: 10254]
- [cite_start]**R_pm (Redemption Velocity):** Target tokens per student/month (Standard = 0.5). [cite: 10255]
- [cite_start]**9 (Time Multiplier):** Hard-coded academic year (Sept-May). [cite: 10258]
- **K_eff (Efficiency Constant):** **0.567**. [cite_start]Derived from (0.90 Net Principal * 0.63 Payout Ratio). [cite: 10259, 10265]
- [cite_start]**r_deal (Deal Rate):** The interest rate assumption (Market = 3.0%, Fortress = 2.0%). [cite: 10266]

## 2. The "Survival Stack" (Priority of Payments)
Yield is distributed in a strict waterfall. [cite_start]Operational revenue is junior to mission fulfillment. [cite: 10271]

1.  [cite_start]**Principal Protection (The Shield) - 25%:** Reinvested to counteract inflation and fund hardware refresh (CapEx). [cite: 10273, 10274]
2.  [cite_start]**Mission Fulfillment (The Welfare) - 63%:** Funds student token redemptions. [cite: 10278, 10280]
3.  **Operator Revenue (The Fee) - 12%:** Remitted to Offbeat Options LLC. [cite_start]**Variable:** Waived if yield compresses. [cite: 10284, 10286, 10288]

## 3. Economic Operating Zones (System Status)
[cite_start]The system monitors the Federal Funds Rate daily and automatically transitions between these zones. [cite: 10289, 10290]

| Zone | Name | Rate Range | System Behavior | UI Status Color |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Normal** | > 2.0% | **Full Capacity.** Operator fee paid at 12%. Surplus flows to growth. | `Emerald/Green` |
| **2** | **Steady** | 1.5% - 2.0% | **Fee Sacrifice.** Operator fee reduced to subsidize payouts. Goal: Maintain 100% student welfare. | `Amber/Yellow` |
| **3** | **Efficient** | 0.1% - 1.5% | **Welfare Throttling.** Operator fee waived (0%). Reinvestment paused. 100% yield to students. Token issuance throttled. | `Orange` |
| **4** | **Freeze** | 0.0% | **Hard Stop.** Token issuance halts. Principal is **never** liquidated. | `Red` |

## 4. Variable Issuance Logic (Zone 3)
In Zone 3, shift from "Target-Based" to "Yield-Available":
[cite_start]`DailyTokens = Total Daily Yield / $25` [cite: 10296, 10297]