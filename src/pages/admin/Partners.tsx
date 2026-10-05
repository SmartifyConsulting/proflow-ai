import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminPage } from "./_shared/AdminPage";
import { AdminPanel } from "./_shared/AdminPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Copy, KeyRound, Plus, BookOpen } from "lucide-react";

export const PARTNER_CATEGORIES = [
  { id: "basic", label: "Basic details" },
  { id: "medical", label: "Medical summary" },
  { id: "documents", label: "Claims documents" },
  { id: "consultations", label: "Consultation summaries" },
];

const db = supabase as any;

export default function Partners() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState("insurer");
  const [email, setEmail] = useState("");
  const [cats, setCats] = useState<string[]>(PARTNER_CATEGORIES.map((c) => c.id));
  const [newKey, setNewKey] = useState<string | null>(null);

  const { data: partners = [] } = useQuery({
    queryKey: ["api-partners"],
    queryFn: async () => {
      const { data, error } = await db.from("api_partners")
        .select("*, api_partner_keys(id, key_prefix, last_used_at, revoked_at, created_at)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: log = [] } = useQuery({
    queryKey: ["partner-access-log"],
    queryFn: async () => {
      const { data } = await db.from("partner_access_log")
        .select("id, endpoint, category, created_at, api_partners(name)")
        .order("created_at", { ascending: false }).limit(50);
      return (data ?? []) as any[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["api-partners"] });

  const addPartner = async () => {
    if (!name.trim()) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await db.from("api_partners").insert({
      name: name.trim(), partner_type: type, contact_email: email.trim() || null,
      allowed_categories: cats, created_by: u.user?.id,
    });
    if (error) return toast({ title: "Could not add partner", description: error.message, variant: "destructive" });
    setName(""); setEmail("");
    refresh();
  };

  const issueKey = async (partnerId: string) => {
    const { data, error } = await supabase.functions.invoke("admin-partner-keys", { body: { partner_id: partnerId } });
    if (error || !data?.key) return toast({ title: "Could not create key", variant: "destructive" });
    setNewKey(data.key);
    refresh();
  };

  const revokeKey = async (keyId: string) => {
    await db.from("api_partner_keys").update({ revoked_at: new Date().toISOString() }).eq("id", keyId);
    refresh();
  };

  const toggleStatus = async (p: any) => {
    await db.from("api_partners").update({ status: p.status === "active" ? "suspended" : "active" }).eq("id", p.id);
    refresh();
  };

  return (
    <AdminPage
      eyebrow="Admin"
      title="Partners"
      description="Outside companies (e.g. insurers) that can request patient information. Patients approve every request."
      actions={<Button asChild variant="outline" size="sm"><Link to="/admin/partner-api-docs"><BookOpen className="mr-1 h-4 w-4" />API guide</Link></Button>}
    >
      <AdminPanel title="Add a partner">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5"><Label>Company name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Type</Label>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="insurer">Insurance</option>
              <option value="fsp">FSP</option>
              <option value="broker">Broker</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="space-y-1.5"><Label>Contact email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          {PARTNER_CATEGORIES.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={cats.includes(c.id)} onCheckedChange={(v) => setCats(v ? [...cats, c.id] : cats.filter((x) => x !== c.id))} />
              {c.label}
            </label>
          ))}
        </div>
        <Button className="mt-3" onClick={addPartner}><Plus className="mr-1 h-4 w-4" />Add partner</Button>
      </AdminPanel>

      <AdminPanel title="Approved partners" noPadding>
        {partners.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No partners yet.</p> : (
          <ul className="divide-y">
            {partners.map((p) => (
              <li key={p.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{p.name} <Badge variant={p.status === "active" ? "default" : "secondary"} className="ml-1">{p.status}</Badge></p>
                    <p className="text-xs text-muted-foreground">{p.partner_type} · {p.contact_email || "no email"} · may request: {p.allowed_categories.map((c: string) => PARTNER_CATEGORIES.find((x) => x.id === c)?.label ?? c).join(", ")}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => toggleStatus(p)}>{p.status === "active" ? "Suspend" : "Reactivate"}</Button>
                    <Button size="sm" onClick={() => issueKey(p.id)}><KeyRound className="mr-1 h-4 w-4" />New key</Button>
                  </div>
                </div>
                {(p.api_partner_keys ?? []).map((k: any) => (
                  <div key={k.id} className="flex items-center justify-between rounded border px-3 py-1.5 text-xs">
                    <span className="font-mono">{k.key_prefix}…</span>
                    <span className="text-muted-foreground">
                      {k.revoked_at ? "Revoked" : k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleString()}` : "Never used"}
                    </span>
                    {!k.revoked_at && <Button size="sm" variant="ghost" onClick={() => revokeKey(k.id)}>Revoke</Button>}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>

      <AdminPanel title="Recent partner activity" noPadding>
        {log.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No activity yet.</p> : (
          <ul className="divide-y text-xs">
            {log.map((l) => (
              <li key={l.id} className="flex justify-between gap-2 px-4 py-2">
                <span className="font-semibold">{l.api_partners?.name ?? "—"}</span>
                <span className="font-mono">{l.endpoint}</span>
                <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>

      <Dialog open={!!newKey} onOpenChange={(o) => !o && setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New access key</DialogTitle>
            <DialogDescription>Copy it now and send it securely to the partner. It will not be shown again.</DialogDescription>
          </DialogHeader>
          <div className="break-all rounded border bg-muted p-3 font-mono text-xs">{newKey}</div>
          <Button onClick={() => { navigator.clipboard.writeText(newKey ?? ""); toast({ title: "Copied" }); }}><Copy className="mr-1 h-4 w-4" />Copy key</Button>
        </DialogContent>
      </Dialog>
    </AdminPage>
  );
}
