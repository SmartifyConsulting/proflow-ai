# Partner API for outside companies (e.g. insurers)

## What you get
- **Partners (Admin menu):** You add an approved company (name, type such as Insurer, contact email), choose which kinds of information it may request, and issue an access key. The key is shown once, and you can revoke or replace it at any time.
- **Patient approval:** A partner asks to see a specific patient's information (identified by ID or medical aid number plus date of birth). The patient sees the request in the app (in notifications and in a new "Connected Companies" section), with exactly what is being asked for. They can approve it, decline it, or later withdraw it. Each approval expires after a set time (12 months by default).
- **Read only:** Partners can only view information. They cannot change anything.
- **What partners can see, if the patient approves that category:**
  - Basic details: name, date of birth, ID number, medical aid and member number
  - Medical summary: allergies, conditions, chronic medication
  - Claims documents: invoices, prescriptions, medical certificates, admissions
  - Consultation summaries: the high-level AI summary only, never recordings or transcripts
- **Audit trail:** Every time a partner looks something up, it is logged. Patients see "who viewed what, when", and you can see it in Admin.
- **Developer page:** A simple guide for partner IT teams covering how to send the key, how to request access, how to fetch data, and example responses.

## Flow
```text
Admin approves partner -> key issued
Partner: request access (patient + categories)
Patient: Approve / Decline in app
Partner: GET data with key -> only approved categories, logged
Patient can revoke any time; access also expires
```

## Technical details
- New tables (all with RLS and grants):
  - `api_partners`: name, type, contact, allowed categories, status
  - `api_partner_keys`: SHA-256 hash and prefix only, last used, revoked_at
  - `partner_access_requests`: partner, patient, categories, status pending/approved/declined/revoked, expires_at, reference
  - `partner_access_log`: partner, patient, endpoint, categories, ip, timestamp
- Patients can read and update their own requests, and can only change the status. Admins (`has_role admin`) manage partners and keys. Partners have no database login.
- A single edge function, `partner-api` (no JWT verification), authenticates with the `Authorization: Bearer hk_live_...` key by hash lookup. Routes:
  - `POST /access-requests`
  - `GET /access-requests/:id`
  - `GET /patients/:id/summary|medical|documents|consultations`
- Every data route checks for an approved, unexpired request covering that category, and returns only the fields in the allow-list. The function uses the service role and writes to `partner_access_log`. Requests are rate limited per key.
- Another edge function, `admin-partner-keys`, generates keys for admins and returns the plaintext key only once.
- UI:
  - `src/pages/admin/Partners.tsx`, plus a route and an Admin sidebar item
  - A patient "Connected Companies" panel in My Details, with approve, decline and revoke actions and an access history
  - A notification is created when a request arrives
  - `src/pages/admin/PartnerApiDocs.tsx`
- Not included: data being written back by partners, and self-service partner sign-up.
