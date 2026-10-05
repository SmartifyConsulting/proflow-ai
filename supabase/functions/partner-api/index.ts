import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CATEGORIES = ["basic", "medical", "documents", "consultations"] as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Simple per-key rate limit (per instance): 120 requests / minute.
const hits = new Map<string, number[]>();
function limited(key: string) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > 120;
}

const RequestSchema = z.object({
  id_number: z.string().trim().min(3).max(40).optional(),
  medical_aid_number: z.string().trim().min(3).max(40).optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categories: z.array(z.enum(CATEGORIES)).min(1),
  purpose: z.string().trim().max(500).optional(),
  reference: z.string().trim().max(100).optional(),
}).refine((v) => v.id_number || v.medical_aid_number, { message: "id_number or medical_aid_number required" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  const rawKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!rawKey.startsWith("hk_live_")) return json({ error: "Missing or invalid API key" }, 401);

  const hash = await sha256(rawKey);
  const { data: keyRow } = await db.from("api_partner_keys")
    .select("id, partner_id, revoked_at, api_partners(id, name, status, allowed_categories)")
    .eq("key_hash", hash).maybeSingle();
  const partner = (keyRow as any)?.api_partners;
  if (!keyRow || keyRow.revoked_at || !partner || partner.status !== "active") {
    return json({ error: "Invalid API key" }, 401);
  }
  if (limited(keyRow.id)) return json({ error: "Rate limit exceeded" }, 429);
  await db.from("api_partner_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? null;
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("partner-api");
  const seg = parts.slice(idx + 1);

  try {
    // POST /access-requests
    if (req.method === "POST" && seg[0] === "access-requests" && seg.length === 1) {
      const parsed = RequestSchema.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      const b = parsed.data;
      const notAllowed = b.categories.filter((c) => !partner.allowed_categories.includes(c));
      if (notAllowed.length) return json({ error: `Not permitted to request: ${notAllowed.join(", ")}` }, 403);

      let q = db.from("patients").select("id, user_id, name").eq("dob", b.date_of_birth);
      q = b.id_number ? q.eq("id_passport_number", b.id_number) : q.eq("medical_aid_number", b.medical_aid_number!);
      const { data: pts } = await q.order("created_at").limit(1);
      const patient = pts?.[0];
      // Same response shape whether or not a match exists, to avoid revealing who is a patient.
      if (!patient || !patient.user_id) return json({ error: "Patient could not be matched or has no app account" }, 404);

      const { data: created, error } = await db.from("partner_access_requests").insert({
        partner_id: partner.id, patient_id: patient.id, patient_user_id: patient.user_id,
        categories: b.categories, purpose: b.purpose ?? null, reference: b.reference ?? null,
      }).select("id, status, created_at").single();
      if (error) throw error;

      await db.from("notifications").insert({
        user_id: patient.user_id, type: "partner_access_request",
        title: `${partner.name} is requesting access to your information`,
        description: "Review and approve or decline in My Details → Connected Companies.",
        reference_id: created.id,
      });
      await db.from("partner_access_log").insert({
        partner_id: partner.id, patient_id: patient.id, patient_user_id: patient.user_id,
        endpoint: "POST /access-requests", ip,
      });
      return json({ request_id: created.id, status: created.status, patient_id: patient.id }, 201);
    }

    // GET /access-requests/:id
    if (req.method === "GET" && seg[0] === "access-requests" && seg.length === 2) {
      const { data } = await db.from("partner_access_requests")
        .select("id, patient_id, categories, status, expires_at, reference, created_at, responded_at")
        .eq("id", seg[1]).eq("partner_id", partner.id).maybeSingle();
      if (!data) return json({ error: "Not found" }, 404);
      const expired = data.status === "approved" && data.expires_at && new Date(data.expires_at) < new Date();
      return json({ ...data, status: expired ? "expired" : data.status });
    }

    // GET /patients/:id/:category
    if (req.method === "GET" && seg[0] === "patients" && seg.length === 3) {
      const patientId = seg[1];
      const map: Record<string, string> = { summary: "basic", medical: "medical", documents: "documents", consultations: "consultations" };
      const category = map[seg[2]];
      if (!category) return json({ error: "Unknown resource" }, 404);
      if (!/^[0-9a-f-]{36}$/i.test(patientId)) return json({ error: "Invalid patient id" }, 400);

      const { data: grants } = await db.from("partner_access_requests")
        .select("id, patient_user_id, expires_at, categories")
        .eq("partner_id", partner.id).eq("patient_id", patientId).eq("status", "approved")
        .contains("categories", [category]).gt("expires_at", new Date().toISOString()).limit(1);
      const grant = grants?.[0];
      if (!grant) return json({ error: "No active patient approval for this information" }, 403);

      let payload: unknown;
      if (category === "basic") {
        const { data } = await db.from("patients")
          .select("id, name, dob, gender, id_passport_number, medical_aid, medical_aid_number").eq("id", patientId).maybeSingle();
        payload = data;
      } else if (category === "medical") {
        const { data } = await db.from("patients")
          .select("allergies, allergies_structured, chronic_medications, is_chronic, blood_type").eq("id", patientId).maybeSingle();
        const { data: hist } = await db.from("patient_medical_history" as any).select("*").eq("patient_id", grant.patient_user_id);
        payload = { ...data, conditions: hist ?? [] };
      } else if (category === "documents") {
        const [inv, rx, adm, docs] = await Promise.all([
          db.from("invoices").select("invoice_number, amount, description, status, due_date, paid_at, created_at").eq("patient_id", patientId),
          db.from("prescriptions").select("medication, dosage, frequency, instructions, start_date, end_date, status, created_at").eq("patient_id", patientId),
          db.from("hospital_admissions").select("hospital, admission_date, discharge_date, diagnosis, procedure_description, status, codes").eq("patient_id", patientId),
          db.from("documents").select("id, name, template_name, record_date, created_at").eq("patient_id", patientId).eq("is_draft", false).ilike("template_name", "%certificate%"),
        ]);
        payload = { invoices: inv.data ?? [], prescriptions: rx.data ?? [], admissions: adm.data ?? [], medical_certificates: docs.data ?? [] };
      } else {
        const { data } = await db.from("sessions")
          .select("id, title, summary, started_at, ended_at").eq("patient_id", patientId).eq("status", "completed")
          .order("started_at", { ascending: false });
        payload = data ?? [];
      }

      await db.from("partner_access_log").insert({
        partner_id: partner.id, patient_id: patientId, patient_user_id: grant.patient_user_id,
        endpoint: `GET /patients/:id/${seg[2]}`, category, ip,
      });
      return json({ patient_id: patientId, category, approval_expires_at: grant.expires_at, data: payload });
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error("partner-api error", e);
    return json({ error: "Internal error" }, 500);
  }
});
