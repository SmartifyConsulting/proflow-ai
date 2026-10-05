import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims, error } = await userClient.auth.getClaims(authHeader.slice(7));
  if (error || !claims?.claims) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: claims.claims.sub, _role: "admin" });
  if (!isAdmin) return json({ error: "Admin role required" }, 403);

  const body = await req.json().catch(() => ({}));
  const partnerId = typeof body.partner_id === "string" ? body.partner_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(partnerId)) return json({ error: "partner_id required" }, 400);

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = "hk_live_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const { error: insErr } = await admin.from("api_partner_keys").insert({
    partner_id: partnerId, key_hash: await sha256(key), key_prefix: key.slice(0, 14),
  });
  if (insErr) return json({ error: insErr.message }, 400);
  return json({ key });
});
