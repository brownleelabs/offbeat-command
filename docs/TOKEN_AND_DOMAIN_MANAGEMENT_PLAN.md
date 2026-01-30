# Token & Domain Management Plan

Use this document to plan how we incorporate **campusmobilityproject.com** and manage physical NTAG tokens from the Command Center. No code in this doc—planning only.

**Companion doc:** **FLEET_AUDIT_AND_DOMAIN_PLAN.md** covers auditability ($25 + interest tethered to token URL), Fleet tab needs, **robustness parity with Campaigns and Deal Desk** (server actions, pagination, audit, validation, error/loading states), SuperAdmin Settings support for fleet, and hardcoding campusmobilityproject.com (owned by Offbeat Options).

---

## 1. Do we need to “connect” new URLs to the 5 existing tokens?

**Short answer: No change in the database.** The app does not store a URL on each token. The claim URL is always:

`{base URL}/claim/{token.id}`

So once the app is served from **campusmobilityproject.com**, every token’s URL is automatically:

`https://campusmobilityproject.com/claim/<token-uuid>`

**Domain:** **campusmobilityproject.com** is now owned and operated by **Offbeat Options.** We can hardcode this domain wherever the claim base URL is needed (see FLEET_AUDIT_AND_DOMAIN_PLAN).

**What you do need to handle:**

- **Hosting:** Point campusmobilityproject.com (DNS) at your app (e.g. Vercel). After that, any link using that base is “connected” for all tokens.
- **Physical NTAGs (the 5 you have):**
  - If they are currently programmed with a different base (e.g. a Vercel URL), you have two options:
    1. **Re-program** each tag with `https://campusmobilityproject.com/claim/<uuid>` (best long-term; one-time per tag).
    2. **Redirect:** Keep the old domain and redirect it to campusmobilityproject.com with the same path (e.g. `old.example.com/claim/xyz` → `campusmobilityproject.com/claim/xyz`). Then existing tags keep working without re-programming.
  - If the 5 tags are not yet programmed, program them with `https://campusmobilityproject.com/claim/<uuid>` and you’re done.

So: no “connecting” step in the app; it’s domain setup + how you program (or redirect for) the physical tags.

---

## 2. The 5 new tokens

To use 5 more tokens you need **5 new rows** in the `tokens` table (with `id`, `campaign_id`, `organization_id`, `status`, `lat`, `lng` as per your schema). Today there is no Command Center UI or server action that creates tokens—they are added via Supabase (SQL or Dashboard).

Planned improvements (see below):

- **One-off:** Instructions + (later) a “Add token” flow so staff can create a single token and get the claim URL to put on an NTAG.
- **Bulk:** Instructions + (later) bulk import so thousands of token rows can be created and a URL list exported for the vendor or internal programming.

Until that exists, the 5 new tokens can be added the same way the first 5 were (e.g. SQL or Supabase Table Editor), then assign them to campaign/school from Fleet.

---

## 3. Build order and where things live

- **Next build focus: Fleet tab.** Improvements to token list, assignment, and (when we add it) claim URL display/copy and bulk actions will live in Fleet.
- **Token-add instructions: Settings tab (SuperAdmin only).** All written instructions for *how to add* new tokens (one-off and bulk) live in the **Settings** tab, in a **"Token management"** (or "NTAG / Tokens") section. Only SUPER_ADMIN sees Settings, so only SuperAdmin sees how to create tokens and how claim URLs are generated. Fleet stays focused on viewing/assigning tokens and (later) copying or exporting URLs; it does not host the "how to add tokens" instructions.

So: **Settings = instructions and policy (SuperAdmin). Fleet = operations (view, assign, copy URL, export).**

### 3.1 SuperAdmin empowerment

The SuperAdmin should feel **empowered** when using the Command Center: they have full control over tokens, URLs, and campaigns in one place. That means:

- **Full instructions** in Settings—not just hints. Step-by-step guidance for adding a **single token** (one-off) and for adding a **large bulk set** (e.g. 1000 or more), so SuperAdmin can run both workflows confidently without hunting for docs or guessing.
- **Token and URL management** is central: tokens are the physical link to campaigns; each claim URL resolves to the campaign assigned to that token. SuperAdmin needs clear instructions and (later) tools to create tokens, assign them to campaigns/schools, and get the correct URLs for programming NTAGs. When they add tokens (one-off or bulk), they should see how it ties to campaigns and why the URL matters.
- **Campaigns connection:** Every token is assigned to a **campaign** (and optionally a school). When a student taps an NTAG, the claim URL loads that campaign’s claim form and data collection. So token management and URL management are inseparable from campaign setup—instructions should make that link explicit.

---

## 4. Where to put instructions in the Command Center

- **Settings tab (SUPER_ADMIN only):** Add a **“Token management”** (or “NTAG / Tokens”) section with **full instructions** so SuperAdmin feels empowered (one-off and bulk 1000+; see Section 6). At first:
  - How to add a **single** new token (current workaround: create row in DB, then assign in Fleet; what URL to use: canonical claim URL—see "Securing claim URLs" below).
  - How to add tokens when **ordering thousands** (process: bulk insert tokens, assign to campaign/school, export or generate list of claim URLs for the vendor; link to future “Bulk import” when built).
  - Token and URL management is important; **URLs connect to campaigns**—each claim URL resolves to the campaign assigned to that token. Instructions should make that link explicit.
  - Reminder: only authorized users can see or generate claim URLs; keep URLs out of public docs and unsecured channels.
- **Fleet tab:** Optional short help text or “?” near the token list: “Claim URL is available per token for authorized users; Copy/Export gated by Fleet write permission.”

Recommendation: put the main **instructions** in **Settings** (with Role permissions and Create user), and keep Fleet focused on assignment. Settings is the right place for “how we manage tokens and the domain.”

---

## 5. Securing claim URLs (so anyone can't just reprogram the chip)

**Goal:** Only authorized staff can see or generate claim URLs. Random people and bad actors should not be able to create valid claim links or easily clone tokens. Plan these details before code.

### 5.1 What we're protecting against

- **Guessing / scanning:** Someone tries token UUIDs or paths to hit valid claim pages. Mitigation: optional signed URLs (see below) so only the app can generate valid links.
- **Cloning:** Someone copies a claim URL and programs another NTAG with it. Result: two physical tags for one token; first tap to complete the claim "wins" (one response per token_id). Mitigation: accept that cloning gives a duplicate, not a new slot; optionally detect duplicate use (same token_id, different locations/times) for fraud review. Limiting who can *see* URLs reduces how often URLs leak.
- **Re-programming the physical chip:** Someone with the tag in hand rewrites it to a different URL. Mitigation: physical—use NTAGs that support lock, or order from a vendor that pre-programs and locks. Not something the app can enforce.

### 5.2 Access control (who can see or generate claim URLs)

- **Viewing / copying claim URLs:** Only users who have access to the Command Center and appropriate permission (e.g. Fleet write or a dedicated "token URL" permission) can see the claim URL for a token. No public listing of token IDs or claim URLs.
- **Generating new tokens and their URLs:** Only SuperAdmin (or a dedicated "token create" permission) can create tokens. Only the app (server-side) generates the canonical claim URL (and, if we add it, the signed parameter). No client-side or public API that returns claim URLs for arbitrary token IDs.
- **Export (bulk URLs):** Export of claim URLs (e.g. CSV for vendor) is gated by the same role that can create tokens or by Fleet write, and only for tokens the user is allowed to see (e.g. by organization). Optional: audit log when a user exports URLs (who, when, how many).

So: **restrict who can see and generate claim URLs; keep URLs out of public docs and unsecured channels.** That way "anyone" cannot easily get the list of URLs to reprogram chips (or clone them).

### 5.3 Optional: signed claim URLs

To make it impossible for someone to guess or scan valid claim links without the secret:

- **Format:** Claim URL includes a signature parameter, e.g. `https://campusmobilityproject.com/claim/<token-id>?k=<signature>`. Signature = HMAC or similar over `token_id` (and optionally expiry), using a server-only secret (env var, not in client).
- **Generation:** Only server-side code (e.g. in a SuperAdmin-only or Fleet-permission action) generates signed URLs when creating a token or when exporting. Bulk export produces one signed URL per token.
- **Verification:** Claim page (or middleware) verifies the signature before showing the form or accepting the claim. Invalid or missing `k` → 404 or "invalid link." This stops enumeration of token IDs and stops random people from building valid URLs.
- **Cloning:** If someone copies a valid signed URL onto another chip, both chips still point to the same token; first claim wins. Signing does not prevent cloning; it prevents *creating* new valid URLs without the secret.
- **Trade-off:** Programming NTAGs becomes "one unique URL per tag" (already true). Bulk orders: export gives N signed URLs; vendor programs each tag with its URL. No change to physical process; only the URLs are now unguessable.

Decide in plan: start with **unsigned** (current: `/claim/<id>`) and add signing later, or ship signed URLs from day one. If you expect token IDs to leak or enumeration to be a concern, signing is recommended before scaling.

### 5.4 What to document in Settings (SuperAdmin)

- Claim URLs are **restricted**: only authorized Command Center users can see or export them. Do not share claim URLs in public or unsecured channels.
- If signed URLs are used: only the app can generate valid links; staff must use the URLs from the Command Center (or export) when programming NTAGs.
- Physical security: where possible, use locked or vendor-pre-programmed tags so the chip cannot be re-programmed by someone who finds the tag.

---

## 6. Full instructions for SuperAdmin (one-off and bulk)

These are the **full instructions** to surface in the Settings "Token management" section so SuperAdmin feels empowered. Token and URL management is important—and **URLs connect to campaigns**: each claim URL resolves to the campaign assigned to that token; the tap loads that campaign's claim form and data collection.

---

### 6.1 Adding a single token (one-off)

**When to use:** You have one NTAG to program (replacement, pilot, or small add).

**Steps (today—until "Add token" exists in Command Center):**

1. **Create the token row** in the database (Supabase Dashboard → Table Editor → `tokens`, or SQL).
   - `id`: generate a new UUID (e.g. Supabase or any UUID generator).
   - `status`: `active`.
   - `campaign_id`: **required**—the UUID of the campaign this token will belong to. The claim URL will load this campaign's form when someone taps the tag.
   - `organization_id`: optional but recommended—the school (or org) this token is tied to.
   - `lat`, `lng`: optional (e.g. 0, 0 if unknown).
2. **In Command Center → Fleet:** Find the new token (filter by campaign or school if needed). If `campaign_id` or `organization_id` wasn't set in step 1, use **Assign to campaign** and/or **Assign to organization** to set them. Every token must be assigned to a campaign for the claim URL to work correctly.
3. **Get the claim URL:**  
   `https://campusmobilityproject.com/claim/<token-id>`  
   Replace `<token-id>` with the token's UUID. This URL is tied to the token's **campaign**—when a student taps the NTAG, they see that campaign's claim form.
4. **Program the NTAG** with that exact URL. Keep the URL restricted (see Securing claim URLs); don't share it in public or unsecured channels.

**Later (when "Add token" exists):** Use **Add token** in Settings or Fleet; choose campaign (and optionally school). The app creates the token and shows its claim URL with a copy button. Program the NTAG with that URL.

---

### 6.2 Adding a large bulk set (e.g. 1000 or more)

**When to use:** You're ordering a large batch of NTAGs (e.g. 1000+) for one or more campaigns/schools. Token and URL management at this scale must be clear so the vendor (or internal team) gets one unique claim URL per tag, each tied to the right campaign.

**Steps (today—until bulk import and URL export exist in Command Center):**

1. **Create many token rows** (1000+).
   - **Option A (SQL):** Run a script or migration that inserts N rows into `tokens` with unique UUIDs, `status = 'active'`, and optionally a default `campaign_id` and `organization_id` if the whole batch is for one campaign/school.
   - **Option B (Supabase / external tool):** Use a CSV with columns `id` (UUID), `status`, `campaign_id`, `organization_id`, `lat`, `lng` and bulk insert into `tokens`.
   - Ensure every token has a **campaign_id** (required for claim URLs to resolve to the correct campaign). If you create tokens without campaign/school, you'll assign in step 2.
2. **In Command Center → Fleet:** Assign tokens to campaigns and schools.
   - Use **Assign selected tokens to a campaign** to set (or change) the campaign for the batch.
   - Use **Assign selected tokens to an organization** to set the school (or org) for the batch.
   - You can do this in batches (e.g. select 500, assign to Campaign A + School X; select next 500, assign to Campaign A + School Y). Every token must be assigned to a campaign so that when a student taps, they get the right campaign's form.
3. **Get the list of claim URLs** for the vendor or internal programming.
   - **Today:** Export token IDs (e.g. from Supabase or a query), then build the URLs: `https://campusmobilityproject.com/claim/<token-id>` for each row. Include `token_id`, `claim_url`, and optionally `campaign_id` / campaign name / school so the vendor can label or batch tags.
   - **Later:** Use **Export claim URLs** (or similar) in Fleet: generate a CSV with `token_id`, `claim_url`, campaign, school. Only authorized users; see Securing claim URLs.
4. **Send the URL list** to the vendor (or use it in-house) so each NTAG is programmed with exactly one claim URL. Remind them: one URL per tag; don't share the list publicly.
5. **Optional:** If you use signed URLs later, the export will include the signed `?k=...` parameter; use those URLs as-is when programming.

**Why campaigns matter for bulk:** Each token's claim URL is tied to its **campaign**. When you assign 1000 tokens to Campaign A, every one of those URLs will show Campaign A's claim form. If you split the batch across campaigns (e.g. 500 for Campaign A, 500 for Campaign B), assign accordingly in Fleet before exporting URLs so the exported list matches the intended campaign per token.

---

### 6.3 Summary for Settings copy

- **One-off:** Create token (with campaign_id) → assign campaign/school in Fleet if needed → get claim URL → program one NTAG. URL connects to the token's campaign.
- **Bulk (1000+):** Create many tokens → assign all to campaign(s) and school(s) in Fleet → export claim URLs (token_id, claim_url, campaign/school) → send to vendor or program in-house. One URL per tag; each URL is tied to that token's campaign.
- **Token and URL management is important:** Tokens are the physical link to campaigns; claim URLs are how students reach the right campaign form. Keep URLs restricted and document the campaign link in instructions.

---

## 7. Token management with the domain: what to build toward

Now that the domain is fixed as **campusmobilityproject.com**, standardize everything on:

**Canonical claim URL:**  
`https://campusmobilityproject.com/claim/<token-uuid>`

**Suggested roadmap (for planning, not implementation here):**

| Capability | Purpose |
|------------|--------|
| **Single “Add token”** | Create one token from Command Center; show and copy its claim URL for one-off NTAG programming. |
| **Bulk create / import** | Create many tokens (e.g. by count or CSV). Assign to campaign/school from Fleet. |
| **Claim URL per token** | In Fleet (or a token detail view), show “Claim URL” and copy button so staff always know what to put on each NTAG. |
| **Export URLs for bulk orders** | After bulk create + assign, export CSV (or similar) with `token_id`, `claim_url`, optional campaign/school so the vendor can program thousands of tags. |
| **Settings copy** | In Settings, one line: “Claim base URL: https://campusmobilityproject.com” (and later, configurable if you ever need a different base). |

**Config:** Hardcode the base URL `https://campusmobilityproject.com` (Offbeat Options) in app for claim links, export, and instructions. If staging or multiple domains are needed later, add env `NEXT_PUBLIC_CLAIM_BASE_URL` defaulting to that value.

---

## 8. Summary

- **Build order:** Fleet tab is next. Token-add *instructions* live in Settings (SuperAdmin only). Settings = instructions and policy; Fleet = operations (view, assign, copy URL, export).
- **Existing 5 tokens:** No DB “connection” of URLs. Point the domain at the app; re-program NTAGs to the new base URL or redirect the old domain.
- **5 more tokens:** Add 5 rows to `tokens` (current process); assign in Fleet; use `https://campusmobilityproject.com/claim/<id>` when programming NTAGs.
- **Command Center instructions:** Add a “Token management” (or “NTAG / Tokens”) section in **Settings** with:
  - One-off: how to add a single token and the claim URL format.
  - Bulk: how you’ll add thousands (create tokens → assign in Fleet → export/generate URL list for vendor); update when bulk import/export exists.
- **Securing claim URLs:** Restrict who can see or generate claim URLs (Command Center + permission); optional signed URLs so only the app can create valid links; document in Settings. Physical re-programming mitigated by locked/vendor-pre-programmed tags where possible.
- **Later:** Single add token, bulk import, “Claim URL” + copy in Fleet, and URL export for bulk orders—all using the canonical base and access control above.

**Auditability and value tether:** The $25 (plus any accruing interest) is digitally tethered to the token URL; management of URLs, IDs, and assignments must be tight and auditable. See **FLEET_AUDIT_AND_DOMAIN_PLAN.md** for fleet audit log, Fleet tab needs (claim URL, export, server actions with audit), and Settings support for fleet.

This gives you a clear path to manage tokens, secure URLs, and leverage the domain end-to-end without changing the 5 existing token rows.
