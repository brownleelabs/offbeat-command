# Campaigns: Auditable Data Collection Engine

Campaigns are the platform’s primary **data collection and audit surface**. They support KYC/compliance, university reporting, and a full chain of record from survey creation through token linkage to every submitted response.

## Why campaigns matter beyond deal desk

- **Token linkage**: Each campaign connects to tokens (digital assets); every claim is tied to a campaign, token, and organization.
- **Configurable questions and required fields**: Universities control what data is collected (KYC fields + custom questions) and can align with export controls and institutional policy.
- **Immutable chain of record**: Every survey created, launched, and submitted is auditable; each response row is immutable with `claim_metadata` (timestamp, server headers) for “why $25?” and payout verification.
- **Value over time**: As more surveys are created and submitted, the data asset grows; the backend is built so reporting, exports, and “big picture” views for university stakeholders scale without rework.

## Backend support (built for scale)

### 1. Campaign lifecycle and governance

- **Campaigns table**: `status` (draft / active / inactive), `launched_at`, `archived_at`/`archived_by`, `deleted_at`/`deleted_by`, `owner_user_id`, `last_viewed_at`, `pinned`/`pinned_at`/`pinned_by`.
- Only **active**, non-archived, non-deleted campaigns accept claims (`submitClaim` enforces this).
- All mutations go through server actions (super-admin–gated); no direct client writes.

### 2. Campaign audit log (`campaign_audit_log`)

- **Append-only** table recording every material action on a campaign.
- **Event types**: `created`, `launched`, `updated`, `archived`, `unarchived`, `deleted`, `restored`, `viewed`, `pinned`, `unpinned`, `exported` (reserved for future).
- **Columns**: `campaign_id`, `event_type`, `actor_user_id`, `at`, `payload` (optional JSON).
- **Indexes**: by `campaign_id` + `at`, by `actor_user_id` + `at`, and by `at` for time-range reporting.
- **RLS**: SUPER_ADMIN only (read + insert). No update/delete.
- Every create, launch, update, archive, delete, restore, view, and pin is logged from `campaign-actions.ts` so university stakeholders can see who did what and when.

### 3. Responses (chain of record)

- **Schema**: Explicit `responses` table with `campaign_id`, `token_id`, `organization_id`, KYC fields, `custom_answers`, `claim_metadata`, `created_at`.
- **Indexes**: `campaign_id`, `token_id`, `organization_id`, `created_at` for ledger queries, exports, and reporting.
- **Immutability**: Rows are insert-only; `claim_metadata` stores `_submitted_at` and server headers for audit.
- **Traceability**: Campaign detail → ledger (responses for that campaign) → response detail (`/responses/[id]`) for full audit (KYC + custom_answers + claim_metadata).

### 4. Claim submission rules

- `submitClaim` validates: campaign exists, `status = 'active'`, `deleted_at` and `archived_at` are null.
- Ensures only live, non-archived campaigns accept claims and that the data collection engine stays consistent.

## Future extensions (backend-ready)

- **Export**: Log `exported` events to `campaign_audit_log` when data is exported (CSV/API); payload can include scope (e.g. campaign_id, date range).
- **Analytics and reporting**: Indexes on `campaign_audit_log` and `responses` support “big picture” queries (e.g. by org, by time, by actor).
- **Org-scoped access**: RLS and server actions can be extended for org-level read/export for college staff while keeping audit log and responses schema unchanged.

## Summary

The campaigns tab is implemented as a **fully auditable data collection engine**: lifecycle and governance on campaigns, append-only audit log for every material action, explicit responses schema with immutable rows and metadata, and strict claim rules. This gives universities a single, traceable picture of survey setup, student interactions, and token-linked claims, and ensures the backend can support scaling and deeper reporting without reinventing the wheel.
