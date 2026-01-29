# Landing Page Redesign Plan — Campus Mobility Project

**Project:** Campus Mobility Project Control Center  
**Scope:** Redesign `app/page.tsx` into a simple landing: about the project, Login, and Request access form. Form submits → store in Supabase + email you so you can create a role.

---

## 1. What this page is (vulture scope)

- **Landing for people with access:** Login. That’s it for them.
- **Dead end without creds:** No sign-up. No fake “get started.” Just short “about the project” info and a **Request access** form. Submit → you get an email (and we store the request in Supabase) so you can create a role in Settings.
- **Simple.** Only information and features we already have: Campus Mobility Control Center (fleet, campaigns, map, settings). Nav: minimal. Hero: project name + one line. Right column: Login + Request access form.
- **No waiting room or “you’re in the right place” copy on the page.** That was internal framing only. Page copy is matter-of-fact: what this is, Sign in, Request access.

---

## 2. Request access → email you (Supabase + email)

**Can we do it with Supabase?**  
- **Supabase:** Good for storing the request (new table). Supabase does **not** send arbitrary transactional email by itself.
- **Email:** Use a small integration in the app. Easiest: **Next.js server action** that (1) inserts the row into Supabase, (2) calls an email API (e.g. **Resend**) to send you an email. You add `RESEND_API_KEY` and `ACCESS_REQUEST_EMAIL` (your email) to env.

**Flow:**
1. User fills Request access form (e.g. name, email, optional message).
2. Submit → server action.
3. Server action: (a) `INSERT` into Supabase table `access_requests`, (b) send email to you via Resend with the same details.
4. You get the email and create the role in Settings as you do today.

**Implementation options:**

| Option | Store in Supabase | Email you |
|--------|-------------------|-----------|
| A (recommended) | Yes — new table `access_requests` | Yes — server action + Resend |
| B | Yes only | No — you check Supabase/dashboard for new rows |
| C | No | Yes — server action + Resend only |

Recommendation: **A**. One migration for `access_requests`, one server action, Resend (or similar) in that action. No Supabase Edge Function required.

---

## 3. Page structure (simple, factual)

- **Navbar:** Logo (Campus Mobility / Control Center), **Login** → `/login`. Minimal. No Services/Pricing/Contact.
- **Hero (left):** Gradient + optional subtle campus silhouettes. Headline: **Campus Mobility Control Center** (or similar). Subtext: one line only — e.g. “Fleet, campaigns, and map for campus mobility.” Optional: **Sign in** link/button → `/login`.
- **Right column — one card:**
  - **Sign in** — link/button to `/login` (for people with access).
  - **Request access** — form: Name, Email, optional Message. Submit → server action → Supabase insert + email you. Button label: “Request access”.
  - Optional: **I’m a Student / Hunter** link → `/schools` (matches login page).
- **Footer:** Optional minimal: © Campus Mobility Project.

No “waiting room,” “you’re in the right place,” or “your administrator creates your account” on the page. Just: what this is, Sign in, Request access.

---

## 4. Copy (matter-of-fact, no metaphor)

| Element | Copy |
|--------|------|
| Logo | Campus Mobility (or Control Center) |
| Headline | Campus Mobility Control Center |
| Subtext | One line: e.g. Fleet, campaigns, and map for campus mobility. |
| Card | Sign in (button → /login). Request access (form). Optional: I’m a Student / Hunter → /schools. |
| Form heading | Request access |
| Form button | Request access |
| Footer | © Campus Mobility Project |

---

## 5. Tech: Request access implementation

1. **Migration:** New table `access_requests` (e.g. `id`, `name`, `email`, `message` text, `created_at`). RLS: allow anon insert only (or service role from server action).
2. **Server action:** e.g. `submitAccessRequest({ name, email, message })`.  
   - Insert into `access_requests`.  
   - Call Resend (or similar) to send email to `process.env.ACCESS_REQUEST_EMAIL` with name, email, message.  
   - Return `{ success: true }` or `{ success: false, error }`.
3. **Form:** Client form that calls this server action. On success: show short “Thanks, we’ll be in touch” (or similar). No auth required for submit.
4. **Env:** `RESEND_API_KEY`, `ACCESS_REQUEST_EMAIL`. Optional: `FROM` email for Resend.

Supabase = storage + audit trail. Email = you get notified. No SSO, no sign-up, no change to auth.

---

## 6. Visual style (unchanged from mockup intent)

- Gradient (orange → deeper orange/red), white card on right, Operational Orange for primary buttons.
- Geist, snappy hover. Optional campus silhouettes. No copy changes to “waiting room” or reassurance metaphors.

---

## 7. Implementation checklist

| Step | Item |
|------|------|
| 1 | Replace `app/page.tsx`: gradient wrapper, navbar (logo + Login), hero (headline + one-line subtext), one right-hand card. |
| 2 | Card: Sign in → `/login`; Request access form (name, email, optional message); optional I’m a Student / Hunter → `/schools`. |
| 3 | Add Supabase migration for `access_requests`. Add server action `submitAccessRequest` (insert + Resend email). Wire form to action. |
| 4 | Env: `RESEND_API_KEY`, `ACCESS_REQUEST_EMAIL`. Document in README or .env.example. |
| 5 | Responsive: two-column → stacked; minimal footer optional. |

**Principle:** Simple Campus Mobility landing. With access → Login. Without → about-the-project info + Request access form that emails you so you can create a role. No waiting room wording on the page.
