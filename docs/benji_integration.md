# Franklin Templeton (BENJI) Technical Integration

[cite_start]**Source of Truth:** BENJI Prospectus & Platform Overview [cite: 9063, 9097]

## 1. Asset Definition
-   [cite_start]**Asset:** Franklin OnChain U.S. Government Money Fund (**FOBXX**). [cite: 9057]
-   [cite_start]**Token:** BENJI. [cite: 9054]
-   [cite_start]**Yield:** Accrues daily, distributed as new tokens. [cite: 9065]

## 2. Intraday Yield Feature
[cite_start]BENJI supports **Intraday Yield**, enabling precise accrual for peer-to-peer transfers. [cite: 9097]
-   [cite_start]**Usage:** Allows the OYE to calculate yield down to the second for "Just-in-Time" rewards. [cite: 7668]

## 3. Data Ingestion
The Offbeat Dashboard must ingest the following from the Benji Institutional API:
-   [cite_start]**7-Day Effective Yield:** To determine the current **Economic Operating Zone**. [cite: 9112]
-   [cite_start]**Real-time AUM:** To calculate the daily "Waterfall" distribution (63/25/12). [cite: 9109]
-   [cite_start]**Transaction History:** For audit trails. [cite: 9112]

## 4. Wallet Architecture
-   **Model:** Hierarchical Deterministic (HD) structure or Sub-Account architecture.
-   **Owner:** University Master Wallet.
-   [cite_start]**Manager:** Offbeat Operator Wallet (whitelisted for management). [cite: 9095]