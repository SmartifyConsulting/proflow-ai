import { AdminPage } from "./_shared/AdminPage";
import { AdminPanel } from "./_shared/AdminPanel";

const BASE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/partner-api`;

const Code = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs"><code>{children}</code></pre>
);

export default function PartnerApiDocs() {
  return (
    <AdminPage eyebrow="Admin · Partners" title="Partner API guide" description="Share this page with a partner's IT team.">
      <AdminPanel title="1. Authentication">
        <p className="mb-2 text-sm">Send your key on every request. Keys start with <code>hk_live_</code>. Limit: 120 requests per minute.</p>
        <Code>{`Authorization: Bearer hk_live_xxxxxxxx\nBase URL: ${BASE}`}</Code>
      </AdminPanel>
      <AdminPanel title="2. Request access to a patient">
        <p className="mb-2 text-sm">The patient is notified in the Holarc app and must approve. Categories: <code>basic</code>, <code>medical</code>, <code>documents</code>, <code>consultations</code>.</p>
        <Code>{`POST ${BASE}/access-requests
{
  "id_number": "8001015009087",        // or "medical_aid_number"
  "date_of_birth": "1980-01-01",
  "categories": ["basic", "documents"],
  "purpose": "Claim #12345 assessment",
  "reference": "CLM-12345"
}

201 → { "request_id": "…", "status": "pending", "patient_id": "…" }`}</Code>
      </AdminPanel>
      <AdminPanel title="3. Check the request status">
        <Code>{`GET ${BASE}/access-requests/{request_id}
→ { "status": "pending" | "approved" | "declined" | "revoked" | "expired", "expires_at": "…" }`}</Code>
      </AdminPanel>
      <AdminPanel title="4. Read approved information (read only)">
        <Code>{`GET ${BASE}/patients/{patient_id}/summary        (basic)
GET ${BASE}/patients/{patient_id}/medical        (medical)
GET ${BASE}/patients/{patient_id}/documents      (documents)
GET ${BASE}/patients/{patient_id}/consultations  (consultations)

200 → { "patient_id": "…", "category": "basic", "approval_expires_at": "…", "data": { … } }
403 → no active approval for that category`}</Code>
        <p className="mt-2 text-xs text-muted-foreground">Every access is logged and visible to the patient. Approvals last 12 months unless the patient withdraws earlier. Recordings and full transcripts are never available.</p>
      </AdminPanel>
    </AdminPage>
  );
}
